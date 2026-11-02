import type { APIRoute } from "astro";
import { jsonError, jsonOk } from "../../../lib/api";
import { getRuntimeEnv } from "../../../lib/env";
import { checkRateLimit, getClientIp } from "../../../lib/rate-limit";

export const prerender = false;

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const MAX_REQUEST_SIZE = MAX_FILE_SIZE + 64 * 1024;
const MAX_UPLOADS_PER_HOUR = 20;
const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

function matchesSignature(type: string, bytes: Uint8Array) {
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));
  if (type === "image/jpeg")
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png")
    return (
      bytes.length >= 8 &&
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (value, index) => bytes[index] === value,
      )
    );
  if (type === "image/gif")
    return ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a";
  if (type === "image/webp")
    return ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP";
  if (type === "image/avif")
    return ascii(4, 4) === "ftyp" && ["avif", "avis"].includes(ascii(8, 4));
  return false;
}

const BASE_KEY =
  /^uploads\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.(?:jpg|png|webp|gif|avif)$/i;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = getRuntimeEnv(locals);
    const bucket = env?.ASSET_BUCKET as R2Bucket | undefined;
    if (!bucket) {
      return jsonError("Asset storage belum tersedia.", 503);
    }

    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_SIZE) {
      return jsonError("Ukuran file maksimal 2 MB.", 413);
    }

    const formData = await request.formData();
    // A card-sized derivative rides along with the upload it belongs to and
    // costs the operator nothing: it counted against the twenty before, so ten
    // products' worth of uploads ran the budget dry and a later `-sm` could be
    // refused (429) unnoticed. A card whose `-sm` is missing is served the full
    // image under a second URL and downloads it twice. The derivative still needs a valid parent key, a
    // signed-in admin and the same size and signature checks below.
    const derivativeOf = String(formData.get("derivative_of") || "").trim();
    // Peek first, spend only once the object is stored: a rejected file is
    // not an upload and must not eat the operator's twenty.
    const uploadDatabase = env?.OMS_DB as D1Database | undefined;
    const uploadBucketKey = `admin-upload:${getClientIp(request.headers)}`;
    if (!derivativeOf) {
      const uploads = await checkRateLimit(uploadDatabase, uploadBucketKey, MAX_UPLOADS_PER_HOUR, 3_600_000, false);
      if (!uploads.allowed) {
        return jsonError("Batas 20 upload per jam telah tercapai.", 429);
      }
    }
    const fileInput = formData.get("file");
    const file = fileInput instanceof File ? fileInput : null;

    if (!file) {
      return jsonError("File upload is required", 400);
    }
    if (!(file.type in EXTENSION_BY_TYPE)) {
      return jsonError(
        "Tipe file tidak didukung. Gunakan JPG, PNG, WEBP, GIF, atau AVIF.",
        415,
      );
    }
    if (file.size <= 0) {
      return jsonError("File upload tidak boleh kosong.", 400);
    }
    if (file.size > MAX_FILE_SIZE) {
      return jsonError("Ukuran file maksimal 2 MB.", 413);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!matchesSignature(file.type, bytes)) {
      return jsonError(
        "Isi file tidak sesuai dengan tipe gambar yang dipilih.",
        415,
      );
    }

    const extension = EXTENSION_BY_TYPE[file.type];
    // A card-sized derivative is stored beside the image it belongs to, so the
    // storefront can address it by name without a second column. The base key
    // is echoed back by the caller rather than trusted freely: it must match
    // the exact shape this route generates, and the suffix is appended here.
    let fileName: string;
    if (derivativeOf) {
      if (!BASE_KEY.test(derivativeOf)) {
        return jsonError("Kunci gambar induk tidak valid.", 400);
      }
      fileName = derivativeOf.replace(/(\.[a-z0-9]+)$/i, `-sm.${extension}`);
    } else {
      fileName = `uploads/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
    }
    await bucket.put(fileName, bytes, {
      httpMetadata: {
        contentType: file.type,
        cacheControl: "public, max-age=31536000, immutable",
        contentDisposition: "inline",
      },
    });
    if (!derivativeOf) await checkRateLimit(uploadDatabase, uploadBucketKey, MAX_UPLOADS_PER_HOUR, 3_600_000);
    return jsonOk({
      url: `/assets/${fileName}`,
      fileName,
    });
  } catch (error) {
    console.error("admin-upload-r2-post", error);
    return jsonError("Gagal mengunggah berkas.", 500);
  }
};
