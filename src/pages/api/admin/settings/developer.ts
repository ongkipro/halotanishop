import type { APIRoute } from "astro";
import { jsonError, jsonOk } from "../../../../lib/api";
import {
  generateApiKeySecret,
  hashApiKeySecret,
  hasOpsScope,
  isApiKeyActive,
  maskApiKeySecret,
  normalizeApiKeyName,
  normalizeApiKeyPolicy,
  parseStoredApiKeyScopes,
} from "../../../../lib/developer-api-keys";
import { getRuntimeEnv } from "../../../../lib/env";

export const prerender = false;

type DeveloperApiKeyRow = {
  id: number;
  name: string;
  key_preview: string;
  created_by: string;
  created_at: string;
  last_used_at: string | null;
  scopes: string;
  rate_limit_per_minute: number;
  daily_quota: number;
};

type HeadlessApiAuditRow = {
  id: number;
  api_key_id: number;
  key_name: string;
  operation: string;
  outcome: string;
  status_code: number;
  created_at: string;
};

const OWNER_ONLY = "Hanya owner yang dapat mengelola API key operasional (scope ops:).";

async function keyHasOpsScope(database: D1Database, id: number) {
  const row = await database
    .prepare("SELECT scopes FROM developer_api_keys WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ scopes: string | null }>();
  return row ? hasOpsScope(parseStoredApiKeyScopes(row.scopes)) : false;
}

function getDatabase(locals: App.Locals): D1Database | null {
  const database = getRuntimeEnv(locals)?.OMS_DB;
  return database && typeof database === "object" ? (database as D1Database) : null;
}

export const GET: APIRoute = async ({ locals }) => {
  const database = getDatabase(locals);
  if (!database) return jsonError("Database developer belum tersedia.", 503);
  if (!locals.admin?.username) return jsonError("Sesi admin tidak valid.", 401);

  try {
    const [keyResult, auditResult] = await Promise.all([
      database
        .prepare(
          `SELECT id, name, key_preview, created_by, created_at, last_used_at,
            scopes, rate_limit_per_minute, daily_quota
          FROM developer_api_keys
          WHERE revoked_at IS NULL
          ORDER BY created_at DESC, id DESC
          LIMIT 100`,
        )
        .all<DeveloperApiKeyRow>(),
      database
        .prepare(
          `SELECT e.id, e.api_key_id, k.name AS key_name, e.operation, e.outcome,
            e.status_code, e.created_at
          FROM headless_api_audit_events e
          INNER JOIN developer_api_keys k ON k.id = e.api_key_id
          ORDER BY e.created_at DESC, e.id DESC
          LIMIT 100`,
        )
        .all<HeadlessApiAuditRow>(),
    ]);

    return jsonOk({
      data: {
        keys: (keyResult.results ?? []).map((key) => ({
          ...key,
          scopes: parseStoredApiKeyScopes(key.scopes),
          active: isApiKeyActive(null),
        })),
        audit_events: auditResult.results ?? [],
      },
    });
  } catch (error) {
    console.error("admin-developer-keys-get", error);
    return jsonError("Gagal memuat API key aktif.", 500);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const database = getDatabase(locals);
  if (!database) return jsonError("Database developer belum tersedia.", 503);
  const createdBy = locals.admin?.username;
  if (!createdBy) return jsonError("Sesi admin tidak valid.", 401);

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    scopes?: unknown;
    rate_limit_per_minute?: unknown;
    daily_quota?: unknown;
  } | null;
  if (!body) return jsonError("Payload tidak valid.", 400);

  const name = normalizeApiKeyName(body.name);
  if (name.length < 2) {
    return jsonError("Nama API key minimal 2 karakter.", 422);
  }
  // A new key names its scopes (REQ-252); only a key stored before scopes
  // existed falls back to the storefront defaults.
  if (!Array.isArray(body.scopes) || body.scopes.length === 0) {
    return jsonError("Pilih minimal satu scope API.", 400);
  }
  const policyResult = normalizeApiKeyPolicy(body);
  if (!policyResult.valid) return jsonError(policyResult.error, 422);
  const policy = policyResult.policy;
  if (hasOpsScope(policy.scopes) && locals.admin?.role !== "owner") {
    return jsonError(OWNER_ONLY, 403);
  }

  try {
    const secret = generateApiKeySecret();
    const secretHash = await hashApiKeySecret(secret);
    const keyPreview = maskApiKeySecret(secret);
    const now = new Date().toISOString();
    const result = await database
      .prepare(
        `INSERT INTO developer_api_keys (
          name, key_hash, key_preview, created_by, created_at,
          scopes, rate_limit_per_minute, daily_quota
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        name,
        secretHash,
        keyPreview,
        createdBy,
        now,
        policy.scopes.join(","),
        policy.rateLimitPerMinute,
        policy.dailyQuota,
      )
      .run();

    if (!result.success || !result.meta.last_row_id) {
      throw new Error("D1 rejected API key creation.");
    }

    return jsonOk(
      {
        message: `API key ${name} berhasil dibuat.`,
        data: {
          key: {
            id: Number(result.meta.last_row_id),
            name,
            key_preview: keyPreview,
            created_by: createdBy,
            created_at: now,
            last_used_at: null,
            scopes: policy.scopes,
            rate_limit_per_minute: policy.rateLimitPerMinute,
            daily_quota: policy.dailyQuota,
            active: true,
          },
          secret,
        },
      },
      201,
    );
  } catch (error) {
    console.error("admin-developer-keys-post", error);
    return jsonError("Gagal membuat API key.", 500);
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  const database = getDatabase(locals);
  if (!database) return jsonError("Database developer belum tersedia.", 503);
  if (!locals.admin?.username) return jsonError("Sesi admin tidak valid.", 401);

  const body = (await request.json().catch(() => null)) as {
    id?: unknown;
    scopes?: unknown;
    rate_limit_per_minute?: unknown;
    daily_quota?: unknown;
  } | null;
  const id = Number(body?.id);
  if (!body || !Number.isInteger(id) || id < 1) {
    return jsonError("ID API key tidak valid.", 400);
  }
  // An omitted list would otherwise reset the key to the storefront defaults,
  // silently dropping its ops: scopes.
  if (!Array.isArray(body.scopes) || body.scopes.length === 0) {
    return jsonError("Pilih minimal satu scope API.", 400);
  }
  const policyResult = normalizeApiKeyPolicy(body);
  if (!policyResult.valid) return jsonError(policyResult.error, 422);
  const policy = policyResult.policy;

  try {
    if (locals.admin?.role !== "owner" && (hasOpsScope(policy.scopes) || (await keyHasOpsScope(database, id)))) {
      return jsonError(OWNER_ONLY, 403);
    }
    const result = await database
      .prepare(
        `UPDATE developer_api_keys
        SET scopes = ?, rate_limit_per_minute = ?, daily_quota = ?
        WHERE id = ? AND revoked_at IS NULL`,
      )
      .bind(
        policy.scopes.join(","),
        policy.rateLimitPerMinute,
        policy.dailyQuota,
        id,
      )
      .run();
    if (result.meta.changes !== 1) {
      return jsonError("API key tidak ditemukan atau sudah dicabut.", 404);
    }
    return jsonOk({
      message: "Kebijakan API key berhasil diperbarui.",
      data: {
        key: {
          id,
          scopes: policy.scopes,
          rate_limit_per_minute: policy.rateLimitPerMinute,
          daily_quota: policy.dailyQuota,
        },
      },
    });
  } catch (error) {
    console.error("admin-developer-keys-patch", error);
    return jsonError("Gagal memperbarui kebijakan API key.", 500);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const database = getDatabase(locals);
  if (!database) return jsonError("Database developer belum tersedia.", 503);
  const revokedBy = locals.admin?.username;
  if (!revokedBy) return jsonError("Sesi admin tidak valid.", 401);

  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id < 1) {
    return jsonError("ID API key tidak valid.", 400);
  }

  try {
    if (locals.admin?.role !== "owner" && (await keyHasOpsScope(database, id))) {
      return jsonError(OWNER_ONLY, 403);
    }
    const revokedAt = new Date().toISOString();
    const result = await database
      .prepare(
        `UPDATE developer_api_keys
        SET revoked_at = ?, revoked_by = ?
        WHERE id = ? AND revoked_at IS NULL`,
      )
      .bind(revokedAt, revokedBy, id)
      .run();

    if (result.meta.changes !== 1) {
      return jsonError("API key tidak ditemukan atau sudah dicabut.", 404);
    }

    return jsonOk({ message: "API key berhasil dicabut." });
  } catch (error) {
    console.error("admin-developer-keys-delete", error);
    return jsonError("Gagal mencabut API key.", 500);
  }
};
