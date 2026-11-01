/**
 * The operations API contract as OpenAPI 3.1 (PRD A45, REQ-264), served at
 * `GET /api/ops/v1/openapi.json`. `docs/OPS-API.md` owns the prose; this owns
 * the machine-readable shape. `ops-openapi.test.ts` fails when a path here and
 * `OPS_OPERATIONS` disagree on path, method or scope.
 */
import { AD_CLICK_KEYS } from "./click-ids.ts";
import { ADMIN_CUSTOM_DATE_FILTER, ADMIN_DATE_FILTER_OPTIONS } from "./admin-date-filter.ts";
import { OPS_ORDERS_PAGE_MAX } from "./ops-order.ts";
import { SOURCE_SLUG_NONE_FILTER } from "./source-slug.ts";

const json = (schema: unknown) => ({ "application/json": { schema } });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const errorResponse = (description: string) => ({ description, content: json(ref("ErrorEnvelope")) });

const authenticatedErrors = {
  "401": { $ref: "#/components/responses/Unauthorized" },
  "403": { $ref: "#/components/responses/Forbidden" },
  "429": { $ref: "#/components/responses/RateLimited" },
  "503": { $ref: "#/components/responses/Unavailable" },
};

const nullableString = { type: ["string", "null"] };
const nullableInteger = { type: ["integer", "null"] };
const filterValue = { type: "string", pattern: "^[a-z_]{1,32}$" };

export const opsOpenApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "AdsBookCMS Operations API",
    version: "1.0.0",
    description:
      "Server-to-server operations API for one AdsBookCMS store. No CORS: call it from a server, a script or the adsbook CLI, never from a browser. Every response is no-store.",
  },
  servers: [{ url: "/api/ops/v1", description: "Current AdsBookCMS install" }],
  security: [{ bearerAuth: [] }, { appKeyAuth: [] }],
  tags: [{ name: "Orders" }, { name: "Contract" }],
  paths: {
    "/orders": {
      get: {
        operationId: "listOrders",
        tags: ["Orders"],
        summary: "List orders, newest first, or sync changes since a time",
        description:
          "Without `updated_since`, newest first by creation. With it, oldest change first by `updated_at`: store the last `updated_at` seen and ask again from there. A cursor is bound to the mode it was issued in.",
        "x-required-scope": "ops:orders:read",
        "x-api-operation": "ordersList",
        parameters: [
          {
            name: "kind",
            in: "query",
            description: "`lead` is an abandoned checkout.",
            schema: { type: "string", enum: ["order", "lead", "all"], default: "order" },
          },
          { name: "status", in: "query", description: "Shipping status.", schema: filterValue },
          { name: "payment_method", in: "query", schema: filterValue },
          { name: "payment_status", in: "query", schema: filterValue },
          {
            name: "date_filter",
            in: "query",
            description: "Period by the Jakarta day of creation, the admin's own rule.",
            schema: {
              type: "string",
              enum: [...ADMIN_DATE_FILTER_OPTIONS.map((option) => option.value), ADMIN_CUSTOM_DATE_FILTER],
              default: "all",
            },
          },
          { name: "date_start", in: "query", description: "With `date_filter=custom`.", schema: { type: "string", format: "date" } },
          { name: "date_end", in: "query", description: "With `date_filter=custom`.", schema: { type: "string", format: "date" } },
          {
            name: "source_slug",
            in: "query",
            description: `Landing or product slug the order came from; \`${SOURCE_SLUG_NONE_FILTER}\` selects orders with none.`,
            schema: { type: "string" },
          },
          { name: "utm_campaign", in: "query", description: "Matched trimmed and lower-cased.", schema: { type: "string" } },
          { name: "updated_since", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "cursor", in: "query", description: "`next_cursor` of the previous page.", schema: { type: "string" } },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: OPS_ORDERS_PAGE_MAX, default: 50 },
          },
        ],
        responses: {
          "200": { description: "One page of orders", content: json(ref("OrderPage")) },
          "400": errorResponse("A filter, limit or cursor is invalid"),
          "422": errorResponse("The custom date range is invalid"),
          "500": errorResponse("Orders could not be loaded"),
          ...authenticatedErrors,
        },
      },
    },
    "/orders/{number}": {
      get: {
        operationId: "getOrder",
        tags: ["Orders"],
        summary: "Read one order with items and its latest payment instruction",
        "x-required-scope": "ops:orders:read",
        "x-api-operation": "orderDetail",
        parameters: [
          { name: "number", in: "path", required: true, description: "Order number, case-insensitive.", schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "The order", content: json(ref("OrderDetailEnvelope")) },
          "404": errorResponse("No order has this number"),
          "500": errorResponse("The order could not be loaded"),
          ...authenticatedErrors,
        },
      },
    },
    "/openapi.json": {
      get: {
        operationId: "getOpenApi",
        tags: ["Contract"],
        summary: "Read this document",
        "x-required-scope": "ops:orders:read",
        "x-api-operation": "openApiRead",
        responses: {
          "200": {
            description: "OpenAPI 3.1 document",
            content: { "application/vnd.oai.openapi+json;version=3.1": { schema: { type: "object" } } },
          },
          ...authenticatedErrors,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "API key" },
      appKeyAuth: { type: "apiKey", in: "header", name: "X-App-Key" },
    },
    responses: {
      Unauthorized: errorResponse("API key is missing, invalid, or revoked"),
      Forbidden: errorResponse("API key lacks the operation's scope"),
      RateLimited: errorResponse("Per-minute rate limit or daily quota is exhausted"),
      Unavailable: errorResponse("Required API policy or data store is unavailable"),
    },
    schemas: {
      ErrorEnvelope: {
        type: "object",
        required: ["success", "error"],
        properties: {
          success: { const: false },
          timestamp: { type: "string", format: "date-time" },
          error: {
            type: "object",
            required: ["message", "code"],
            properties: { message: { type: "string" }, code: { type: "string" } },
          },
        },
      },
      OrderPage: {
        type: "object",
        required: ["success", "data", "next_cursor"],
        properties: {
          success: { const: true },
          data: { type: "array", items: ref("Order") },
          next_cursor: nullableString,
        },
      },
      OrderDetailEnvelope: {
        type: "object",
        required: ["success", "data"],
        properties: { success: { const: true }, data: ref("OrderDetail") },
      },
      Order: {
        type: "object",
        description:
          "`customer`, `attribution.click_ids`, `payment.switched_by` and `payment.instruction.virtual_account` are present only for a key holding `ops:orders:read_pii`.",
        required: [
          "id", "number", "kind", "created_at", "updated_at", "confirmed_at", "void",
          "status", "payment", "amounts", "shipping", "destination", "attribution",
        ],
        properties: {
          id: { type: "integer" },
          number: { type: "string" },
          kind: { type: "string", enum: ["order", "lead"] },
          created_at: { type: "string" },
          updated_at: { type: "string", format: "date-time" },
          confirmed_at: nullableString,
          void: { type: "boolean" },
          status: {
            type: "object",
            properties: { shipping: { type: "string" }, payment: nullableString },
          },
          payment: {
            type: "object",
            properties: {
              method: nullableString,
              status: nullableString,
              switched_from: nullableString,
              switched_at: nullableString,
              switched_by: nullableString,
              instruction: ref("PaymentInstruction"),
            },
          },
          amounts: {
            type: "object",
            description: "Whole rupiah.",
            properties: {
              items: { type: "number" },
              discount: { type: "number" },
              shipping: { type: "number" },
              cod_fee: { type: "number" },
              total: { type: "number" },
            },
          },
          shipping: {
            type: "object",
            properties: {
              courier: nullableString,
              service: nullableString,
              resi: nullableString,
              provider_order_id: nullableString,
              provider_status: nullableString,
              provider_status_at: nullableString,
              warehouse_id: nullableInteger,
            },
          },
          destination: {
            type: "object",
            properties: { district: nullableString, city: nullableString, province: nullableString },
          },
          attribution: {
            type: "object",
            properties: {
              source_slug: nullableString,
              traffic_source: { type: "string", enum: ["meta", "google", "organic", "custom"] },
              utm: {
                type: "object",
                properties: Object.fromEntries(
                  ["source", "medium", "campaign", "content", "term"].map((key) => [key, nullableString]),
                ),
              },
              click_ids: {
                type: "object",
                properties: Object.fromEntries(AD_CLICK_KEYS.map((key) => [key, { type: "string" }])),
              },
            },
          },
          customer: {
            type: "object",
            properties: {
              name: nullableString,
              phone: nullableString,
              email: nullableString,
              address: nullableString,
              postal_code: nullableString,
            },
          },
        },
      },
      OrderDetail: {
        allOf: [
          ref("Order"),
          {
            type: "object",
            required: ["items"],
            properties: { items: { type: "array", items: ref("OrderItem") } },
          },
        ],
      },
      OrderItem: {
        type: "object",
        properties: {
          product: nullableString,
          product_slug: nullableString,
          variant: nullableString,
          sku: nullableString,
          quantity: { type: "integer" },
          unit_price: { type: "number" },
          weight_grams: { type: ["number", "null"] },
        },
      },
      PaymentInstruction: {
        type: "object",
        description: "The latest payment transaction; detail only.",
        properties: {
          channel_code: nullableString,
          amount: { type: "number" },
          admin_fee: { type: ["number", "null"] },
          total_amount: { type: "number" },
          virtual_account: nullableString,
          expires_at: nullableString,
          paid_at: nullableString,
          status: { type: "string" },
        },
      },
    },
  },
} as const;
