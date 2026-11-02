/**
 * The one set of rules for what an image upload may weigh. Browser-only for
 * the canvas work; the decision logic is pure so it can be tested under node.
 *
 * Two upload paths used to disagree. ProductForm converted and resized, but
 * its "already-small WebP" pass-through measured smallness as "under 2 MB", so
 * a 1254px WebP saved at high quality sailed through untouched — one such file
 * is a 132KB homepage hero PSI scores at ~44KB. ContentWorkbench, the path
 * hero and content media actually arrive through, converted nothing at all: a
 * raw 5MB PNG was stored as-is. Both now route through this module.
 *
 * Existing files in R2 are deliberately left alone — the rule governs uploads
 * from here on, there is no backfill.
 */

/** Longest edge stored. The product detail column is 480 CSS px at DPR 2.625
 *  = 1260 device pixels; 1280 keeps a hair of headroom. */
export const MAX_IMAGE_EDGE = 1280;
/** The catalogue-card derivative: 182 CSS px is 478 device pixels on the
 *  phone Lighthouse emulates. */
export const CARD_IMAGE_EDGE = 480;
/** Canvas WebP quality. The canvas encoder is noticeably less efficient than
 *  libwebp at the same setting, so 0.8 here lands near the quality PSI's
 *  byte estimates assume. */
export const WEBP_QUALITY = 0.8;
/** The "already small" the old 2MB check meant. Set below the case that
 *  motivated it — a 132KB hero PSI scored at ~44KB — because bytes alone
 *  cannot tell a fair large photo from an over-saved one; under this bar a
 *  re-encode could not win back enough to be worth the generational loss,
 *  above it one is always worth trying. */
export const LEAN_WEBP_BYTES = 100 * 1024;
/** Hard ceiling on what an encode may produce. */
export const MAX_ENCODED_BYTES = 2 * 1024 * 1024;

/** Formats the canvas can re-encode without losing something it cannot keep.
 *  GIF animation and AVIF would be flattened or inflated, so they pass by. */
export function canConvertToWebP(mimeType: string): boolean {
  return ["image/jpeg", "image/png", "image/webp"].includes(
    mimeType.toLowerCase(),
  );
}

/** Pure decision: reuse the uploaded bytes only when they are a WebP that is
 *  both within the edge budget and genuinely lean. */
export function shouldReuseWebP(
  file: { type: string; size: number },
  dimensions: { width: number; height: number },
  maxEdge: number = MAX_IMAGE_EDGE,
): boolean {
  return (
    file.type === "image/webp" &&
    file.size <= LEAN_WEBP_BYTES &&
    Math.max(dimensions.width, dimensions.height) <= maxEdge
  );
}

/** Scale to maxEdge and encode as WebP. Browser-only. */
export function convertImageToWebP(
  file: File,
  maxEdge: number = MAX_IMAGE_EDGE,
): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const sourceWidth = img.naturalWidth || img.width;
      const sourceHeight = img.naturalHeight || img.height;
      if (
        shouldReuseWebP(file, { width: sourceWidth, height: sourceHeight }, maxEdge)
      ) {
        return resolve(file);
      }
      const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight || 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(sourceWidth * scale);
      canvas.height = Math.round(sourceHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Gagal mengolah canvas gambar."));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("Gagal konversi gambar ke WebP."));
          // A browser that cannot encode WebP from a canvas hands back PNG
          // instead of failing; labelling that `image/webp` only earned a 415
          // from the server's signature check with no hint why.
          if (blob.type !== "image/webp") {
            return reject(
              new Error(
                "Browser ini tidak bisa mengonversi gambar ke WebP. Unggah file .webp, atau gunakan Chrome/Firefox.",
              ),
            );
          }
          if (blob.size > MAX_ENCODED_BYTES) {
            return reject(new Error("Ukuran file terkompresi masih melebihi 2 MB."));
          }
          resolve(
            new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", {
              type: "image/webp",
            }),
          );
        },
        "image/webp",
        WEBP_QUALITY,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("File gambar tidak dapat dibaca."));
    };
    img.src = url;
  });
}

/**
 * Store the card-sized `-sm` twin of an upload beside it (480 px, served by
 * `cardImageSrc`). Resolves false, never throws, when it could not be stored:
 * the original upload already succeeded, and the asset route falls back to the
 * full image, so the caller tells the operator instead of failing the upload.
 * Every admin path that stores an image a card may show calls this.
 */
export async function uploadCardDerivative(source: File, fileName: string): Promise<boolean> {
  try {
    const card = await convertImageToWebP(source, CARD_IMAGE_EDGE);
    const form = new FormData();
    form.set("file", card);
    form.set("derivative_of", fileName);
    const response = await fetch("/api/admin/upload-r2", { method: "POST", body: form });
    return response.ok;
  } catch {
    return false;
  }
}
