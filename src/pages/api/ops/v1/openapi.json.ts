import type { APIRoute } from "astro";
import { opsJson, validateOpsRequest } from "../../../../lib/ops-api";
import { opsOpenApiDocument } from "../../../../lib/ops-openapi";

export const prerender = false;

/** PRD A45, REQ-264: the operations contract as OpenAPI 3.1. */
export const GET: APIRoute = async ({ request, locals }) => {
  const access = await validateOpsRequest(request, locals, "openApiRead");
  if (!access.allowed) return access.response;
  return access.finalize(
    opsJson(opsOpenApiDocument, 200, {
      ...access.headers,
      "content-type": "application/vnd.oai.openapi+json;version=3.1",
    }),
  );
};
