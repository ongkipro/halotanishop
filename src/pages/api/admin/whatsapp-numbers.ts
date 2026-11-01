import type { APIRoute } from "astro";
import { jsonError, jsonOk } from "../../../lib/api";
import { getRuntimeEnv } from "../../../lib/env";
import {
  addWhatsappNumber,
  listWhatsappNumbers,
  removeWhatsappNumber,
  updateWhatsappNumber,
  WhatsappNumberError,
} from "../../../lib/whatsapp-numbers";

export const prerender = false;

/**
 * The support WhatsApp numbers /thanks rotates through (PRD A35). Owner and
 * admin only (`ADMIN_API_ROUTES`). Every answer is the full list, so the page
 * never has to guess what a write changed.
 */
function database(locals: App.Locals) {
  const db = getRuntimeEnv(locals)?.OMS_DB as D1Database | undefined;
  if (!db?.prepare) throw new WhatsappNumberError("Database belum tersedia.", 503);
  return db;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    throw new WhatsappNumberError("Body JSON tidak valid.", 400);
  }
}

function failure(error: unknown, fallback: string) {
  if (error instanceof WhatsappNumberError) return jsonError(error.message, error.status);
  console.error("admin-whatsapp-numbers", error);
  return jsonError(fallback, 500);
}

export const GET: APIRoute = async ({ locals }) => {
  try {
    return jsonOk({ data: await listWhatsappNumbers(database(locals)) });
  } catch (error) {
    return failure(error, "Nomor WhatsApp gagal dimuat.");
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const db = database(locals);
    const body = await readBody(request);
    await addWhatsappNumber(db, { label: body.label, phone: body.phone });
    return jsonOk({ data: await listWhatsappNumbers(db) }, 201);
  } catch (error) {
    return failure(error, "Nomor WhatsApp gagal disimpan.");
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  try {
    const db = database(locals);
    const body = await readBody(request);
    await updateWhatsappNumber(db, Number(body.id), {
      label: body.label,
      phone: body.phone,
      is_active: body.is_active === undefined ? undefined : body.is_active === true,
    });
    return jsonOk({ data: await listWhatsappNumbers(db) });
  } catch (error) {
    return failure(error, "Nomor WhatsApp gagal diperbarui.");
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const db = database(locals);
    const body = await readBody(request);
    await removeWhatsappNumber(db, Number(body.id));
    return jsonOk({ data: await listWhatsappNumbers(db) });
  } catch (error) {
    return failure(error, "Nomor WhatsApp gagal dihapus.");
  }
};
