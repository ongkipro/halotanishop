import type { APIRoute } from "astro";
import {
  AbandonedLeadError,
  assertAbandonedLeadExists,
  convertAbandonedLead,
  LEAD_FOLLOW_UP_STATUSES,
  updateAbandonedLead,
  type LeadFollowUpStatus,
} from "../../../lib/abandoned-lead.ts";
import { jsonError, jsonOk } from "../../../lib/api.ts";
import { selectQuotedRate } from "../../../lib/courier-rules.ts";
import { getRuntimeEnv } from "../../../lib/env.ts";
import {
  sourceFacetStatement,
  sourceFilterOptions,
  sourceLabelsFromRows,
  sourceLabelsStatement,
  sourceSlugPredicate,
} from "../../../lib/source-slug.ts";
import {
  isCodBlockedForProvince,
  loadStoreCodDisabledProvinceCodes,
} from "../../../lib/form-mode.ts";
import {
  resolveEligibleShippingRates,
  ShippingQuoteError,
} from "../../../lib/shipping-quote.ts";

export const prerender = false;

const FOLLOW_UP_FILTERS = ["all", ...LEAD_FOLLOW_UP_STATUSES] as const;

type AbandonedLeadListRow = {
  id: number;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  total_amount: number;
  lead_follow_up_status: string;
  lead_followed_up_at: string | null;
  lead_followed_up_by: string | null;
  lead_follow_up_note: string | null;
  created_at: string;
  source_page_path: string | null;
  source_slug: string | null;
  product_id: number | null;
  product_title: string | null;
  variant_id: number | null;
  variant_title: string | null;
  quantity: number | null;
  unit_price: number | null;
};

type ProductOptionRow = {
  product_id: number;
  product_title: string;
  variant_id: number;
  variant_title: string;
  sku: string;
  price: number;
  stock: number | null;
};

function databaseFrom(locals: App.Locals) {
  const database = getRuntimeEnv(locals)?.OMS_DB;
  return database && typeof database === "object"
    ? (database as D1Database)
    : null;
}

function errorResponse(error: unknown, label: string) {
  if (error instanceof AbandonedLeadError) {
    return jsonError(error.message, error.status);
  }
  if (error instanceof ShippingQuoteError) {
    return jsonError(error.message, error.status, { code: error.code });
  }
  console.error(label, error);
  return jsonError("Gagal memproses pesanan tertinggal.", 500);
}

export const GET: APIRoute = async ({ url, locals }) => {
  const database = databaseFrom(locals);
  if (!database) return jsonError("Database order belum tersedia.", 503);

  const search = url.searchParams.get("search")?.trim().slice(0, 120) || "";
  const followUpStatus =
    url.searchParams.get("follow_up_status")?.trim().toLowerCase() || "all";
  const page = Math.max(
    Number.parseInt(url.searchParams.get("page") || "1", 10) || 1,
    1,
  );
  const limit = Math.min(
    Math.max(Number.parseInt(url.searchParams.get("limit") || "25", 10) || 25, 1),
    100,
  );
  if (!FOLLOW_UP_FILTERS.includes(followUpStatus as (typeof FOLLOW_UP_FILTERS)[number])) {
    return jsonError("Filter follow-up tidak valid.", 400);
  }

  const conditions = ["o.shipping_status = 'abandoned'"];
  const params: unknown[] = [];
  if (search) {
    conditions.push(
      "(o.customer_name LIKE ? OR o.customer_phone LIKE ? OR o.order_number LIKE ? OR p.title LIKE ?)",
    );
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }
  if (followUpStatus !== "all") {
    conditions.push("o.lead_follow_up_status = ?");
    params.push(followUpStatus);
  }
  // The page the lead was captured on (PRD A36). A read filter only.
  const sourceSlug = sourceSlugPredicate(url.searchParams.get("source_slug"), "o.source_slug");
  if (sourceSlug) {
    conditions.push(sourceSlug.sql);
    params.push(...sourceSlug.params);
  }
  const withSourceOptions = url.searchParams.get("source_options") === "1";
  const where = `WHERE ${conditions.join(" AND ")}`;
  const offset = (page - 1) * limit;

  try {
    const [countResult, rowsResult, statusResult, productResult, warehouseResult, labelResult, facetResult] = await database.batch([
      database.prepare(
        `SELECT COUNT(DISTINCT o.id) AS total_items
         FROM orders o
         LEFT JOIN order_items oi ON oi.order_id = o.id
         LEFT JOIN product_variants pv ON pv.id = oi.variant_id
         LEFT JOIN products p ON p.id = pv.product_id
         ${where}`,
      ).bind(...params),
      database.prepare(
        `SELECT
           o.id, o.order_number, o.customer_name, o.customer_phone,
           o.total_amount, o.lead_follow_up_status, o.lead_followed_up_at,
           o.lead_followed_up_by, o.lead_follow_up_note, o.created_at,
           o.source_page_path, o.source_slug,
           p.id AS product_id, p.title AS product_title,
           pv.id AS variant_id, pv.title AS variant_title,
           oi.quantity, oi.unit_price
         FROM orders o
         LEFT JOIN order_items oi ON oi.id = (
           SELECT first_item.id FROM order_items first_item
           WHERE first_item.order_id = o.id ORDER BY first_item.id LIMIT 1
         )
         LEFT JOIN product_variants pv ON pv.id = oi.variant_id
         LEFT JOIN products p ON p.id = pv.product_id
         ${where}
         ORDER BY o.id DESC
         LIMIT ? OFFSET ?`,
      ).bind(...params, limit, offset),
      database.prepare(
        `SELECT lead_follow_up_status AS status, COUNT(*) AS count
         FROM orders
         WHERE shipping_status = 'abandoned'
         GROUP BY lead_follow_up_status`,
      ),
      database.prepare(
        `SELECT
           p.id AS product_id, p.title AS product_title,
           pv.id AS variant_id, pv.title AS variant_title,
           pv.sku, pv.price, pv.stock
         FROM product_variants pv
         INNER JOIN products p ON p.id = pv.product_id
         WHERE p.is_active = 1
         ORDER BY p.title, pv.id
         LIMIT 500`,
      ),
      database.prepare(
        `SELECT id, name
         FROM warehouses
         ORDER BY is_primary DESC, id
         LIMIT 1`,
      ),
      sourceLabelsStatement(database),
      withSourceOptions
        ? sourceFacetStatement(database, "leads")
        : database.prepare("SELECT NULL AS slug, 0 AS count WHERE 0"),
    ]);
    const facets = (facetResult?.results || []) as Array<{ slug: string; count: number }>;
    const sourceLabels = sourceLabelsFromRows(
      [
        ...((rowsResult.results || []) as unknown as AbandonedLeadListRow[]).map((row) => row.source_slug),
        ...facets.map((row) => row.slug),
      ],
      (labelResult?.results || []) as Parameters<typeof sourceLabelsFromRows>[1],
    );
    const totalItems = Number(
      (countResult.results?.[0] as { total_items?: number } | undefined)
        ?.total_items || 0,
    );
    const counts = Object.fromEntries(
      ((statusResult.results || []) as Array<{ status: string; count: number }>).map(
        (row) => [row.status, Number(row.count) || 0],
      ),
    );
    return jsonOk({
      data: (rowsResult.results || []).map((raw) => {
        const row = raw as unknown as AbandonedLeadListRow;
        return {
          id: row.id,
          order_number: row.order_number,
          customer_name: row.customer_name,
          customer_phone: row.customer_phone,
          product_id: row.product_id,
          product_title: row.product_title,
          variant_id: row.variant_id,
          variant_title: row.variant_title,
          quantity: row.quantity,
          unit_price: row.unit_price,
          total_amount: row.total_amount,
          follow_up_status: row.lead_follow_up_status,
          followed_up_at: row.lead_followed_up_at,
          followed_up_by: row.lead_followed_up_by,
          follow_up_note: row.lead_follow_up_note,
          created_at: row.created_at,
          source_page_path: row.source_page_path,
          source_slug: row.source_slug,
          source_label: row.source_slug ? sourceLabels.get(row.source_slug)?.label ?? row.source_slug : null,
        };
      }),
      ...(withSourceOptions ? { source_options: sourceFilterOptions(facets, sourceLabels) } : {}),
      pagination: {
        page,
        limit,
        total_items: totalItems,
        total_pages: totalItems ? Math.ceil(totalItems / limit) : 0,
      },
      status_counts: {
        all: Object.values(counts).reduce((sum, count) => sum + count, 0),
        new: counts.new || 0,
        contacted: counts.contacted || 0,
        qualified: counts.qualified || 0,
        not_interested: counts.not_interested || 0,
      },
      product_options: (productResult.results || []).map((raw) => {
        const row = raw as unknown as ProductOptionRow;
        return {
          product_id: row.product_id,
          product_title: row.product_title,
          variant_id: row.variant_id,
          variant_title: row.variant_title,
          sku: row.sku,
          price: row.price,
          stock: row.stock,
        };
      }),
      warehouse: warehouseResult.results?.[0] || null,
    });
  } catch (error) {
    return errorResponse(error, "admin-abandoned-orders-get");
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  const database = databaseFrom(locals);
  if (!database) return jsonError("Database order belum tersedia.", 503);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("Payload tidak valid.", 400);
  const orderId = Number(body.order_id);
  const variantId = body.variant_id === undefined ? undefined : Number(body.variant_id);
  const quantity = body.quantity === undefined ? undefined : Number(body.quantity);
  try {
    const updated = await updateAbandonedLead(database, orderId, {
      customerName:
        typeof body.customer_name === "string" ? body.customer_name : undefined,
      customerPhone:
        typeof body.customer_phone === "string" ? body.customer_phone : undefined,
      followUpStatus:
        typeof body.follow_up_status === "string"
          ? (body.follow_up_status as LeadFollowUpStatus)
          : undefined,
      followUpNote:
        typeof body.follow_up_note === "string" ? body.follow_up_note : undefined,
      followedUpBy: locals.admin?.username,
      variantId,
      quantity,
    });
    return jsonOk({
      message: `Pesanan tertinggal ${updated.orderNumber} berhasil diperbarui.`,
      data: { id: updated.id, order_number: updated.orderNumber },
    });
  } catch (error) {
    return errorResponse(error, "admin-abandoned-orders-patch");
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const database = databaseFrom(locals);
  if (!database) return jsonError("Database order belum tersedia.", 503);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || body.action !== "convert") {
    return jsonError("Aksi pesanan tertinggal tidak valid.", 400);
  }
  const orderId = Number(body.order_id);
  const variantId = Number(body.variant_id);
  const quantity = Number(body.quantity);
  const courierServiceId = Number(body.courier_service_id);
  const destinationAreaId = String(body.destination_area_id || "").trim();
  const city = String(body.city || "").trim();
  const courierCode = String(body.courier_code || "").trim();
  if (
    !Number.isSafeInteger(orderId) ||
    orderId < 1 ||
    !Number.isInteger(courierServiceId) ||
    courierServiceId < 1 ||
    !Number.isSafeInteger(variantId) ||
    variantId < 1 ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 100 ||
    !destinationAreaId ||
    destinationAreaId.length > 120 ||
    city.length < 2 ||
    city.length > 120 ||
    !courierCode ||
    courierCode.length > 50
  ) {
    return jsonError("Produk, jumlah, dan layanan pengiriman wajib dipilih.", 422);
  }

  try {
    await assertAbandonedLeadExists(database, orderId);
    // Conversion always creates a COD order, so it answers to the same
    // province policy checkout does; the CS console is not a way around it.
    if (
      isCodBlockedForProvince(
        "cod",
        String(body.province || ""),
        await loadStoreCodDisabledProvinceCodes(database),
      )
    ) {
      return jsonError(
        "COD tidak tersedia untuk provinsi tujuan ini. Arahkan pembeli ke pembayaran online.",
        422,
      );
    }
    const quote = await resolveEligibleShippingRates(database, locals, {
      destinationId: destinationAreaId,
      destinationCity: city,
      paymentMethod: "cod",
      variantKey: String(variantId),
      quantity,
      // The warehouse follows the province the CS console previewed with (PRD A42).
      destinationProvince: String(body.province || "") || undefined,
    });
    const selectedRate = selectQuotedRate(
      quote.rates,
      courierCode,
      courierServiceId,
    );
    if (!selectedRate || !quote.warehouse?.id) {
      return jsonError(
        "Pilihan kurir sudah tidak tersedia. Hitung ulang ongkir.",
        409,
      );
    }
    const converted = await convertAbandonedLead(database, orderId, {
      customerName: String(body.customer_name || ""),
      customerPhone: String(body.customer_phone || ""),
      address: String(body.address || ""),
      district: String(body.district || ""),
      city,
      province: String(body.province || ""),
      postalCode:
        typeof body.postal_code === "string" ? body.postal_code : undefined,
      destinationAreaId,
      variantId,
      quantity,
      warehouseId: quote.warehouse.id,
      courierCode: selectedRate.courier_code,
      courierService: selectedRate.courier_service,
      // Same rule as storefront checkout: the COD service fee is the store's,
      // added once downstream; the provider's `cod_fee` is not shipping.
      shippingCost: Number(selectedRate.price),
      followedUpBy: locals.admin?.username || "",
    });
    return jsonOk({
      message: `${converted.orderNumber} masuk ke order baru dan siap ditinjau sebelum push ke Mengantar.`,
      data: {
        id: converted.id,
        order_number: converted.orderNumber,
        shipping_status: "pending",
      },
    });
  } catch (error) {
    return errorResponse(error, "admin-abandoned-orders-post");
  }
};
