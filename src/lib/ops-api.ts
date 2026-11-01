/**
 * The operations API (PRD A45, REQ-251): `/api/ops/v1`, beside the storefront
 * headless API, on the same keys, quotas and audit trail.
 *
 * Server-to-server only. It sends no CORS headers and does not read the
 * storefront origin allowlist, so a browser on another origin can never read a
 * response. Every response is `no-store`: order payloads carry buyer data.
 *
 * Every route file under `src/pages/api/ops/v1` is registered here with one
 * minimum scope; `ops-api.test.ts` fails on a route that is not.
 */
import type { OpsApiScope } from "./developer-api-keys.ts";
import {
  enforceHeadlessUsageLimits,
  recordHeadlessApiAudit,
  validateHeadlessApiKey,
  type AuthenticatedApiKey,
} from "./headless-api.ts";

export const OPS_OPERATIONS = {
  ordersList: { scope: "ops:orders:read", method: "GET", path: "/api/ops/v1/orders" },
  orderDetail: { scope: "ops:orders:read", method: "GET", path: "/api/ops/v1/orders/{number}" },
  // lazy: the contract reads with the base read scope; a key holding only
  // `ops:catalog:read` (A-441) cannot fetch it until this accepts any ops scope.
  openApiRead: { scope: "ops:orders:read", method: "GET", path: "/api/ops/v1/openapi.json" },
} as const satisfies Record<string, { scope: OpsApiScope; method: "GET" | "POST"; path: string }>;

export type OpsOperation = keyof typeof OPS_OPERATIONS;

export function opsJson(data: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(headers || {}),
    },
  });
}

export function opsError(message: string, status: number, code: string, headers?: Record<string, string>) {
  return opsJson({ success: false, error: { message, code } }, status, headers);
}

/** Keep the policy headers of a shared-validator refusal, drop its CORS ones. */
async function withoutCors(response: Response) {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (!name.toLowerCase().startsWith("access-control-")) headers[name] = value;
  });
  headers["cache-control"] = "no-store";
  return new Response(await response.text(), { status: response.status, headers });
}

function policyHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.startsWith("X-RateLimit") || name.startsWith("X-DailyQuota")),
  );
}

export type OpsRequest = {
  key: AuthenticatedApiKey;
  /** Rate-limit and quota headers for the response. */
  headers: Record<string, string>;
  /** Audits the handler's final status once, then returns the response. */
  finalize: (response: Response) => Promise<Response>;
};

export async function validateOpsRequest(
  request: Request,
  locals: App.Locals | undefined,
  operation: OpsOperation,
): Promise<{ allowed: false; response: Response } | ({ allowed: true } & OpsRequest)> {
  const label = `ops.${operation}`;
  const auth = await validateHeadlessApiKey(request, locals, {}, label, OPS_OPERATIONS[operation].scope);
  if (!auth.allowed) return { allowed: false, response: await withoutCors(auth.errorResponse) };
  let usage;
  try {
    usage = await enforceHeadlessUsageLimits(auth.key, label);
  } catch {
    return {
      allowed: false,
      response: opsError("Kebijakan penggunaan API tidak dapat diterapkan.", 503, "API_KEY_POLICY_UNAVAILABLE"),
    };
  }
  if (!usage.allowed) return { allowed: false, response: await withoutCors(usage.errorResponse) };
  const headers = policyHeaders(usage.corsHeaders);
  let finalized = false;
  return {
    allowed: true,
    key: auth.key,
    headers,
    async finalize(response: Response) {
      if (finalized) return response;
      finalized = true;
      try {
        await recordHeadlessApiAudit(auth.key.database, auth.key.id, label, "allowed", response.status, new Date().toISOString());
      } catch (error) {
        console.error("ops-api-audit-write-failed", {
          operation: label,
          statusCode: response.status,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return response;
    },
  };
}
