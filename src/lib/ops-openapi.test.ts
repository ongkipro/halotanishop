import assert from "node:assert/strict";
import test from "node:test";
import { OPS_OPERATIONS } from "./ops-api.ts";
import { opsOpenApiDocument } from "./ops-openapi.ts";
import { serializeOpsOrder, type OpsOrderRow } from "./ops-order.ts";

const SERVER = opsOpenApiDocument.servers[0].url;

function collectRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) collectRefs(item, refs);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "$ref" && typeof item === "string") refs.push(item);
      else collectRefs(item, refs);
    }
  }
  return refs;
}

function resolve(ref: string): unknown {
  return ref
    .slice(2)
    .split("/")
    .reduce<unknown>((node, token) => (node && typeof node === "object" ? (node as Record<string, unknown>)[token] : undefined), opsOpenApiDocument);
}

test("REQ-264: every registered operation is one OpenAPI operation with the same path, method and scope, and the reverse", () => {
  const documented = Object.entries(opsOpenApiDocument.paths).flatMap(([path, item]) =>
    Object.entries(item).map(([method, operation]) => ({
      name: operation["x-api-operation"],
      method: method.toUpperCase(),
      path: `${SERVER}${path}`,
      scope: operation["x-required-scope"],
    })),
  );
  const registered = Object.entries(OPS_OPERATIONS).map(([name, operation]) => ({ name, ...operation }));
  const key = (row: { name: string; method: string; path: string; scope: string }) =>
    `${row.name} ${row.method} ${row.path} ${row.scope}`;
  assert.deepEqual(documented.map(key).sort(), registered.map(key).sort());
});

test("the document is OpenAPI 3.1, every $ref resolves, every operation lists the auth refusals", () => {
  assert.equal(opsOpenApiDocument.openapi, "3.1.0");
  for (const ref of collectRefs(opsOpenApiDocument)) assert.ok(resolve(ref), ref);
  for (const item of Object.values(opsOpenApiDocument.paths)) {
    for (const operation of Object.values(item)) {
      for (const status of ["401", "403", "429", "503"]) assert.ok(status in operation.responses);
    }
  }
});

test("the Order schema names every field the serializer writes, PII included", () => {
  const row = new Proxy({ id: 1, order_number: "INV-1", ad_click_ids: '{"gclid":"g","utm_source":"meta"}' }, {
    get: (target, name) => (name in target ? target[name as keyof typeof target] : null),
    has: () => true,
  }) as unknown as OpsOrderRow;
  const order = serializeOpsOrder(row, { pii: true });
  const schema = opsOpenApiDocument.components.schemas.Order;
  const check = (value: Record<string, unknown>, properties: Record<string, any>, at: string) => {
    for (const [field, inner] of Object.entries(value)) {
      assert.ok(field in properties, `${at}${field} is not in the Order schema`);
      if (inner && typeof inner === "object" && !Array.isArray(inner) && properties[field].properties) {
        check(inner as Record<string, unknown>, properties[field].properties, `${at}${field}.`);
      }
    }
  };
  check(order, schema.properties, "");
  for (const field of schema.required) assert.ok(field in order, `required ${field} missing from the serializer`);
});
