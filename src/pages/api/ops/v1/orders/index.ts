import type { APIRoute } from "astro";
import { getRuntimeEnv } from "../../../../../lib/env";
import { opsError, opsJson, validateOpsRequest } from "../../../../../lib/ops-api";
import { listOpsOrders, OpsQueryError } from "../../../../../lib/ops-order";

export const prerender = false;

/** PRD A45, REQ-254: orders, filtered, cursor-paged, or synced by `updated_since`. */
export const GET: APIRoute = async ({ request, url, locals }) => {
  const access = await validateOpsRequest(request, locals, "ordersList");
  if (!access.allowed) return access.response;
  const database = getRuntimeEnv(locals)?.OMS_DB as D1Database;
  try {
    const page = await listOpsOrders(database, url.searchParams, {
      pii: access.key.scopes.includes("ops:orders:read_pii"),
    });
    return access.finalize(opsJson({ success: true, data: page.orders, next_cursor: page.next_cursor }, 200, access.headers));
  } catch (error) {
    if (error instanceof OpsQueryError) {
      return access.finalize(opsError(error.message, error.status, error.code, access.headers));
    }
    console.error("ops-orders-list", error);
    return access.finalize(opsError("Order gagal dimuat.", 500, "INTERNAL", access.headers));
  }
};
