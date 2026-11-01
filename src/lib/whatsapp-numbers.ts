/**
 * The store's support WhatsApp numbers (PRD A35, migration 0067).
 *
 * The only writer of `whatsapp_numbers`. Every write also refreshes
 * `stores.support_whatsapp` to the first active number, in the same batch, so
 * the surfaces outside /thanks keep reading one value that agrees with the list.
 *
 * The two rules an operator can trip — at most ten numbers, and never zero
 * active — are part of the SQL statement that writes, not a read before it, so
 * two admins clicking at once cannot both pass a check that only one should.
 */

export const WHATSAPP_NUMBERS_MAX = 10;
export const WHATSAPP_LABEL_MAX = 60;

export type WhatsappNumber = {
  id: number;
  label: string;
  phone: string;
  is_active: boolean;
};

export class WhatsappNumberError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "WhatsappNumberError";
    this.status = status;
  }
}

/**
 * The `wa.me` form, or null when /thanks could not use the number: digits only,
 * a leading 0 becomes 62, then 62 and 8 to 13 digits. The same rule as
 * `thanksWhatsappUrl`, so a saved number is always one the page can open.
 */
export function normalizeWhatsappPhone(input: unknown): string | null {
  const digits = String(input ?? "").replace(/\D/g, "").replace(/^0/, "62");
  return /^62\d{8,13}$/.test(digits) ? digits : null;
}

/** "62812…" as an Indonesian reader writes it: 0812-3456-7890. */
export function formatWhatsappDisplay(phone: string): string {
  const local = String(phone).replace(/^62/, "0");
  return local.replace(/^(\d{4})(\d{4})(\d+)$/, "$1-$2-$3");
}

/** The header line on the admin page: how /thanks splits COD orders. */
export function whatsappShareSummary(activeCount: number): string {
  if (activeCount <= 0) return "Belum ada nomor aktif — tombol WhatsApp di halaman terima kasih disembunyikan.";
  if (activeCount === 1) return "1 nomor aktif · menerima semua order COD.";
  const share = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(100 / activeCount);
  return `${activeCount} nomor aktif · tiap nomor ±${share}% order COD, dibagi per order.`;
}

function cleanLabel(input: unknown): string {
  const label = String(input ?? "").trim();
  if (label.length > WHATSAPP_LABEL_MAX) {
    throw new WhatsappNumberError(`Label maksimal ${WHATSAPP_LABEL_MAX} karakter.`, 422);
  }
  return label;
}

function requirePhone(input: unknown): string {
  const phone = normalizeWhatsappPhone(input);
  if (!phone) {
    throw new WhatsappNumberError("Nomor WhatsApp harus nomor Indonesia: 08… atau 628…, 10–15 digit.", 422);
  }
  return phone;
}

function isUniqueViolation(error: unknown): boolean {
  return /UNIQUE constraint failed/i.test(String((error as Error)?.message ?? error));
}

/** Keeps `stores.support_whatsapp` on the first active number; a no-op with none. */
function mirrorStatement(database: D1Database) {
  return database.prepare(
    `UPDATE stores
        SET support_whatsapp = (
          SELECT phone FROM whatsapp_numbers WHERE is_active = 1 ORDER BY id LIMIT 1
        )
      WHERE id = (SELECT id FROM stores ORDER BY id LIMIT 1)
        AND EXISTS (SELECT 1 FROM whatsapp_numbers WHERE is_active = 1)`,
  );
}

export async function listWhatsappNumbers(database: D1Database): Promise<WhatsappNumber[]> {
  const result = await database
    .prepare("SELECT id, label, phone, is_active FROM whatsapp_numbers ORDER BY id")
    .all<{ id: number; label: string; phone: string; is_active: number }>();
  return (result.results ?? []).map((row) => ({
    id: Number(row.id),
    label: String(row.label ?? ""),
    phone: String(row.phone),
    is_active: Number(row.is_active) === 1,
  }));
}

export async function addWhatsappNumber(
  database: D1Database,
  input: { label?: unknown; phone?: unknown },
  now: Date = new Date(),
): Promise<void> {
  const phone = requirePhone(input.phone);
  const label = cleanLabel(input.label);
  let results: D1Result[];
  try {
    results = await database.batch([
      database
        .prepare(
          `INSERT INTO whatsapp_numbers (label, phone, is_active, created_at)
           SELECT ?, ?, 1, ?
            WHERE (SELECT COUNT(*) FROM whatsapp_numbers) < ?`,
        )
        .bind(label, phone, now.toISOString(), WHATSAPP_NUMBERS_MAX),
      mirrorStatement(database),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new WhatsappNumberError("Nomor ini sudah ada di daftar.", 409);
    throw error;
  }
  if (!results[0]?.meta?.changes) {
    throw new WhatsappNumberError(`Maksimal ${WHATSAPP_NUMBERS_MAX} nomor WhatsApp.`, 409);
  }
}

export async function updateWhatsappNumber(
  database: D1Database,
  id: number,
  input: { label?: unknown; phone?: unknown; is_active?: unknown },
): Promise<void> {
  if (!Number.isInteger(id) || id < 1) throw new WhatsappNumberError("ID nomor tidak valid.", 422);
  const existing = await database
    .prepare("SELECT label, phone, is_active FROM whatsapp_numbers WHERE id = ?")
    .bind(id)
    .first<{ label: string; phone: string; is_active: number }>();
  if (!existing) throw new WhatsappNumberError("Nomor tidak ditemukan.", 404);

  const label = input.label === undefined ? existing.label : cleanLabel(input.label);
  const phone = input.phone === undefined ? existing.phone : requirePhone(input.phone);
  const active = input.is_active === undefined ? Number(existing.is_active) === 1 : input.is_active === true;

  let results: D1Result[];
  try {
    results = await database.batch([
      database
        .prepare(
          `UPDATE whatsapp_numbers
              SET label = ?, phone = ?, is_active = ?
            WHERE id = ?
              AND (? = 1 OR EXISTS (
                SELECT 1 FROM whatsapp_numbers WHERE is_active = 1 AND id <> ?
              ))`,
        )
        .bind(label, phone, active ? 1 : 0, id, active ? 1 : 0, id),
      mirrorStatement(database),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new WhatsappNumberError("Nomor ini sudah ada di daftar.", 409);
    throw error;
  }
  if (!results[0]?.meta?.changes) {
    throw new WhatsappNumberError("Minimal satu nomor harus tetap aktif.", 409);
  }
}

export async function removeWhatsappNumber(database: D1Database, id: number): Promise<void> {
  if (!Number.isInteger(id) || id < 1) throw new WhatsappNumberError("ID nomor tidak valid.", 422);
  const results = await database.batch([
    database
      .prepare(
        `DELETE FROM whatsapp_numbers
          WHERE id = ?
            AND (is_active = 0 OR EXISTS (
              SELECT 1 FROM whatsapp_numbers WHERE is_active = 1 AND id <> ?
            ))`,
      )
      .bind(id, id),
    mirrorStatement(database),
  ]);
  if (results[0]?.meta?.changes) return;
  const exists = await database
    .prepare("SELECT 1 AS found FROM whatsapp_numbers WHERE id = ?")
    .bind(id)
    .first();
  throw exists
    ? new WhatsappNumberError("Minimal satu nomor harus tetap aktif.", 409)
    : new WhatsappNumberError("Nomor tidak ditemukan.", 404);
}

/**
 * What /thanks may hand a buyer to: the active numbers in id order, or, for a
 * store whose list is empty (no number at install, or one the migration could
 * not normalise), the legacy `stores.support_whatsapp`. Never throws: a failed
 * read is an empty list, and the page then hides its WhatsApp button.
 */
export async function activeThanksNumbers(database: D1Database): Promise<string[]> {
  try {
    const result = await database
      .prepare("SELECT phone FROM whatsapp_numbers WHERE is_active = 1 ORDER BY id")
      .all<{ phone: string }>();
    const phones = (result.results ?? []).map((row) => String(row.phone));
    if (phones.length) return phones;
  } catch (error) {
    console.error("thanks-whatsapp-numbers-load", error);
  }
  try {
    const store = await database
      .prepare("SELECT support_whatsapp FROM stores ORDER BY id LIMIT 1")
      .first<{ support_whatsapp: string | null }>();
    const legacy = normalizeWhatsappPhone(store?.support_whatsapp);
    return legacy ? [legacy] : [];
  } catch (error) {
    console.error("thanks-whatsapp-legacy-load", error);
    return [];
  }
}
