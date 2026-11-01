/**
 * The store's warehouses (PRD A42, REQ-237, REQ-238, REQ-248).
 *
 * The writer of `warehouses` for Pengaturan → Gudang. (`save-warehouse` in
 * `api/admin/settings.ts` still edits the primary for older clients.) Each
 * rule an operator can trip — at most ten, exactly one primary, the primary
 * stays active, a warehouse with orders is never deleted — is part of the SQL
 * statement that writes, so two admins at once cannot both pass a check.
 *
 * Mengantar is reached only through the injected `ensurePickup`, so tests stub
 * it and no test talks to the provider.
 */
import type { MengantarPickupAddressInput } from "./mengantar-client.ts";
import { normalizeProvinceCode, validateProvinceCodeList } from "./province.ts";
import { isWarehouseReady, servedProvinceCodes } from "./warehouse-choice.ts";

/** Matches the shipping workspace, which lists at most ten warehouses. */
export const WAREHOUSES_MAX = 10;

const PHONE_PATTERN = /^\+?\d{9,15}$/;

export type Warehouse = {
  id: number;
  name: string;
  contact_name: string;
  contact_phone: string;
  origin_area_id: string;
  origin_label: string;
  pickup_address_id: string;
  address: string;
  city: string;
  province: string;
  province_code: string;
  is_primary: boolean;
  is_active: boolean;
  /** Effective list: the stored one, or the warehouse's own province. */
  served_provinces: string[];
  /** Origin and pickup address both set at Mengantar; only then is it chosen. */
  ready: boolean;
  order_count: number;
};

export type WarehouseInput = {
  name?: unknown;
  contact_name?: unknown;
  contact_phone?: unknown;
  origin_area_id?: unknown;
  origin_label?: unknown;
  pickup_address_id?: unknown;
  address?: unknown;
  city?: unknown;
  province?: unknown;
  served_provinces?: unknown;
};

/** `null` when the store has no Mengantar key: the pickup id is then kept as given. */
export type EnsurePickup = ((input: MengantarPickupAddressInput) => Promise<string>) | null;

export class WarehouseError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "WarehouseError";
    this.status = status;
  }
}

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function requireId(id: number) {
  if (!Number.isSafeInteger(id) || id < 1) throw new WarehouseError("ID gudang tidak valid.", 422);
}

type WarehouseRow = {
  id: number;
  name: string;
  contact_name: string | null;
  contact_phone: string | null;
  origin_area_id: string | null;
  origin_label: string | null;
  pickup_address_id: string | null;
  address: string;
  city: string;
  province: string;
  is_primary: number;
  is_active: number;
  served_provinces: string | null;
  order_count: number;
};

export async function listWarehouses(database: D1Database): Promise<Warehouse[]> {
  const result = await database
    .prepare(
      `SELECT w.id, w.name, w.contact_name, w.contact_phone, w.origin_area_id, w.origin_label,
        w.pickup_address_id, w.address, w.city, w.province, w.is_primary, w.is_active,
        w.served_provinces,
        (SELECT COUNT(*) FROM orders o WHERE o.warehouse_id = w.id) AS order_count
      FROM warehouses w
      ORDER BY w.is_primary DESC, w.id`,
    )
    .all<WarehouseRow>();
  return (result.results ?? []).map((row) => ({
    id: Number(row.id),
    name: String(row.name ?? ""),
    contact_name: String(row.contact_name ?? ""),
    contact_phone: String(row.contact_phone ?? ""),
    origin_area_id: String(row.origin_area_id ?? ""),
    origin_label: String(row.origin_label ?? ""),
    pickup_address_id: String(row.pickup_address_id ?? ""),
    address: String(row.address ?? ""),
    city: String(row.city ?? ""),
    province: String(row.province ?? ""),
    province_code: normalizeProvinceCode(row.province),
    is_primary: Number(row.is_primary) === 1,
    is_active: Number(row.is_active) === 1,
    served_provinces: servedProvinceCodes(row),
    ready: isWarehouseReady(row),
    order_count: Number(row.order_count) || 0,
  }));
}

/**
 * The stored `served_provinces`: NULL when the warehouse serves only its own
 * province, else a JSON array that always starts with it (REQ-239: the
 * operator adds provinces to the default, never removes the own one).
 */
export function servedProvincesValue(ownProvince: string, extra: unknown): string | null {
  const own = normalizeProvinceCode(ownProvince);
  if (extra === undefined || extra === null) return null;
  const checked = validateProvinceCodeList(extra);
  if (!checked.success) {
    throw new WarehouseError(`Kode provinsi tidak dikenal: ${checked.invalidCodes.join(", ")}.`, 422);
  }
  const codes = [...new Set([own, ...checked.codes].filter(Boolean))];
  return codes.length === 0 || (codes.length === 1 && codes[0] === own) ? null : JSON.stringify(codes);
}

function validated(input: WarehouseInput) {
  const fields = {
    name: clean(input.name, 120),
    contact_name: clean(input.contact_name, 120),
    contact_phone: clean(input.contact_phone, 20).replace(/[\s()-]/g, ""),
    origin_area_id: clean(input.origin_area_id, 120),
    origin_label: clean(input.origin_label, 300),
    pickup_address_id: clean(input.pickup_address_id, 120),
    address: clean(input.address, 500),
    city: clean(input.city, 120),
    province: clean(input.province, 120),
  };
  if (!fields.name || !fields.contact_name || !fields.address) {
    throw new WarehouseError("Lengkapi nama gudang, PIC, dan alamat.", 422);
  }
  // REQ-238: the origin must be a precise Mengantar sub-district, which the
  // picker only yields with its area id, city and province together.
  if (!fields.origin_area_id || !fields.city || !fields.province) {
    throw new WarehouseError("Pilih kecamatan origin dari pencarian Mengantar.", 422);
  }
  if (!PHONE_PATTERN.test(fields.contact_phone)) {
    throw new WarehouseError("Telepon PIC harus berisi 9-15 digit.", 422);
  }
  return {
    ...fields,
    served_provinces: servedProvincesValue(fields.province, input.served_provinces),
  };
}

async function registerPickup(
  ensurePickup: EnsurePickup,
  fields: ReturnType<typeof validated>,
): Promise<string> {
  if (!ensurePickup) return fields.pickup_address_id;
  try {
    return await ensurePickup({
      addressId: fields.pickup_address_id || undefined,
      pickupName: fields.name,
      pickupPic: fields.contact_name,
      pickupPicPhone: fields.contact_phone,
      pickupAddress: fields.address,
      pickupAutofill: fields.origin_area_id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sinkronisasi pickup address Mengantar gagal.";
    throw new WarehouseError(`${message} Data gudang tidak diubah.`, message.includes("timeout") ? 504 : 502);
  }
}

/** Adds a warehouse; the first one a store has becomes its primary. Returns the new id. */
export async function addWarehouse(
  database: D1Database,
  input: WarehouseInput,
  ensurePickup: EnsurePickup,
): Promise<number> {
  const fields = validated(input);
  const full = await database
    .prepare("SELECT COUNT(*) AS total FROM warehouses")
    .first<{ total: number }>();
  // Checked before Mengantar is asked, so a full list registers no pickup
  // address; the INSERT below re-checks it for the concurrent case.
  if (Number(full?.total) >= WAREHOUSES_MAX) {
    throw new WarehouseError(`Maksimal ${WAREHOUSES_MAX} gudang.`, 409);
  }
  const pickupAddressId = await registerPickup(ensurePickup, fields);
  const result = await database
    .prepare(
      `INSERT INTO warehouses (
        store_id, name, contact_name, contact_phone, origin_area_id, origin_label,
        pickup_address_id, address, city, province, served_provinces, is_active, is_primary
      )
      SELECT (SELECT id FROM stores ORDER BY id LIMIT 1), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1,
        NOT EXISTS (SELECT 1 FROM warehouses WHERE is_primary = 1)
      WHERE (SELECT COUNT(*) FROM warehouses) < ?
        AND EXISTS (SELECT 1 FROM stores)`,
    )
    .bind(
      fields.name,
      fields.contact_name,
      fields.contact_phone,
      fields.origin_area_id,
      fields.origin_label,
      pickupAddressId,
      fields.address,
      fields.city,
      fields.province,
      fields.served_provinces,
      WAREHOUSES_MAX,
    )
    .run();
  if (!result.meta?.changes) throw new WarehouseError(`Maksimal ${WAREHOUSES_MAX} gudang.`, 409);
  return Number(result.meta.last_row_id);
}

export async function updateWarehouse(
  database: D1Database,
  id: number,
  input: WarehouseInput,
  ensurePickup: EnsurePickup,
): Promise<void> {
  requireId(id);
  const exists = await database.prepare("SELECT id FROM warehouses WHERE id = ?").bind(id).first();
  if (!exists) throw new WarehouseError("Gudang tidak ditemukan.", 404);
  const fields = validated(input);
  const pickupAddressId = await registerPickup(ensurePickup, fields);
  await database
    .prepare(
      `UPDATE warehouses
        SET name = ?, contact_name = ?, contact_phone = ?, origin_area_id = ?, origin_label = ?,
          pickup_address_id = ?, address = ?, city = ?, province = ?, served_provinces = ?
        WHERE id = ?`,
    )
    .bind(
      fields.name,
      fields.contact_name,
      fields.contact_phone,
      fields.origin_area_id,
      fields.origin_label,
      pickupAddressId,
      fields.address,
      fields.city,
      fields.province,
      fields.served_provinces,
      id,
    )
    .run();
}

/** "Jadikan utama": only an active, ready warehouse can be the primary. */
export async function setPrimaryWarehouse(database: D1Database, id: number): Promise<void> {
  requireId(id);
  const eligible = `EXISTS (
    SELECT 1 FROM warehouses WHERE id = ? AND is_active = 1
      AND trim(origin_area_id) <> '' AND trim(pickup_address_id) <> ''
  )`;
  // One batch, so the partial unique index never sees two primaries and a
  // refused target never leaves the store with none.
  const results = await database.batch([
    database.prepare(`UPDATE warehouses SET is_primary = 0 WHERE is_primary = 1 AND id <> ? AND ${eligible}`).bind(id, id),
    database.prepare(`UPDATE warehouses SET is_primary = 1 WHERE id = ? AND ${eligible}`).bind(id, id),
  ]);
  if (results[1]?.meta?.changes) return;
  const row = await database
    .prepare("SELECT is_primary FROM warehouses WHERE id = ?")
    .bind(id)
    .first<{ is_primary: number }>();
  if (!row) throw new WarehouseError("Gudang tidak ditemukan.", 404);
  if (Number(row.is_primary) === 1) return;
  throw new WarehouseError("Hanya gudang aktif yang siap di Mengantar yang bisa dijadikan utama.", 409);
}

/** REQ-248: the primary cannot be made inactive. */
export async function setWarehouseActive(database: D1Database, id: number, active: boolean): Promise<void> {
  requireId(id);
  const result = await database
    .prepare("UPDATE warehouses SET is_active = ? WHERE id = ? AND (? = 1 OR is_primary = 0)")
    .bind(active ? 1 : 0, id, active ? 1 : 0)
    .run();
  if (result.meta?.changes) return;
  const row = await database.prepare("SELECT id FROM warehouses WHERE id = ?").bind(id).first();
  throw row
    ? new WarehouseError("Gudang utama tidak bisa dinonaktifkan. Jadikan gudang lain utama dulu.", 409)
    : new WarehouseError("Gudang tidak ditemukan.", 404);
}

/**
 * REQ-248: a warehouse any order or pickup schedule points at is never
 * deleted (deactivate it instead), and neither is the primary.
 */
export async function deleteWarehouse(database: D1Database, id: number): Promise<void> {
  requireId(id);
  const result = await database
    .prepare(
      `DELETE FROM warehouses
        WHERE id = ? AND is_primary = 0
          AND NOT EXISTS (SELECT 1 FROM orders WHERE warehouse_id = ?)
          AND NOT EXISTS (SELECT 1 FROM pickup_schedules WHERE warehouse_id = ?)`,
    )
    .bind(id, id, id)
    .run();
  if (result.meta?.changes) return;
  const row = await database
    .prepare("SELECT is_primary FROM warehouses WHERE id = ?")
    .bind(id)
    .first<{ is_primary: number }>();
  if (!row) throw new WarehouseError("Gudang tidak ditemukan.", 404);
  if (Number(row.is_primary) === 1) {
    throw new WarehouseError("Gudang utama tidak bisa dihapus. Jadikan gudang lain utama dulu.", 409);
  }
  throw new WarehouseError("Gudang ini sudah dipakai order atau jadwal pickup. Nonaktifkan saja.", 409);
}
