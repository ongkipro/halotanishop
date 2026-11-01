import type { APIRoute } from "astro";
import { jsonError, jsonOk } from "../../../lib/api";
import { getRuntimeEnv } from "../../../lib/env";
import { MengantarClient } from "../../../lib/mengantar-client";
import { getProviderConfig } from "../../../lib/provider-config";
import {
  addWarehouse,
  deleteWarehouse,
  listWarehouses,
  setPrimaryWarehouse,
  setWarehouseActive,
  updateWarehouse,
  WAREHOUSES_MAX,
  WarehouseError,
  type EnsurePickup,
} from "../../../lib/warehouses";

export const prerender = false;

/**
 * Pengaturan → Gudang (PRD A42). Owner and admin only (`ADMIN_API_ROUTES`).
 * Every answer is the full list, so the page never guesses what a write did.
 */
function database(locals: App.Locals) {
  const db = getRuntimeEnv(locals)?.OMS_DB as D1Database | undefined;
  if (!db?.prepare) throw new WarehouseError("Database belum tersedia.", 503);
  return db;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    throw new WarehouseError("Body JSON tidak valid.", 400);
  }
}

/** Registers the pickup address at Mengantar, as `save-warehouse` always has. */
async function pickupRegistrar(db: D1Database, locals: App.Locals): Promise<EnsurePickup> {
  const config = (await getProviderConfig(db, locals)).mengantar;
  if (!config.apiKey) return null;
  const client = new MengantarClient(config.apiKey, config.baseUrl);
  return (input) => client.ensurePickupAddress(input);
}

async function answer(db: D1Database, status = 200) {
  return jsonOk({ data: await listWarehouses(db), max: WAREHOUSES_MAX }, status);
}

function failure(error: unknown, fallback: string) {
  if (error instanceof WarehouseError) return jsonError(error.message, error.status);
  console.error("admin-warehouses", error);
  return jsonError(fallback, 500);
}

export const GET: APIRoute = async ({ locals }) => {
  try {
    return await answer(database(locals));
  } catch (error) {
    return failure(error, "Daftar gudang gagal dimuat.");
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const db = database(locals);
    const body = await readBody(request);
    await addWarehouse(db, body, await pickupRegistrar(db, locals));
    return await answer(db, 201);
  } catch (error) {
    return failure(error, "Gudang gagal disimpan.");
  }
};

/**
 * `action`: "update" (the editor's fields), "primary", "activate" or
 * "deactivate".
 */
export const PATCH: APIRoute = async ({ request, locals }) => {
  try {
    const db = database(locals);
    const body = await readBody(request);
    const id = Number(body.id);
    if (body.action === "primary") await setPrimaryWarehouse(db, id);
    else if (body.action === "activate") await setWarehouseActive(db, id, true);
    else if (body.action === "deactivate") await setWarehouseActive(db, id, false);
    else if (body.action === "update") await updateWarehouse(db, id, body, await pickupRegistrar(db, locals));
    else throw new WarehouseError("Aksi gudang tidak dikenal.", 400);
    return await answer(db);
  } catch (error) {
    return failure(error, "Gudang gagal diperbarui.");
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const db = database(locals);
    const body = await readBody(request);
    await deleteWarehouse(db, Number(body.id));
    return await answer(db);
  } catch (error) {
    return failure(error, "Gudang gagal dihapus.");
  }
};
