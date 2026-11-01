import { ADMIN_CUSTOM_DATE_FILTER, adminDateSelectionFromQuery } from "./admin-date-filter.ts";

/**
 * One description of the `/admin/orders` list request, shared by the
 * OrdersTable island and the page that server-renders its first rows. The
 * page runs the list route itself with this query, so the first paint is the
 * API's own answer — same status CASE, date range, buyer links and bank
 * fallback — not a restated SELECT that drifted from it (review 2026-10-31:
 * the restated one still showed a void order as "Menunggu", ignored
 * `date_filter`, and sent the old payment link from a WA chip).
 */
export type OrderListFilters = {
  search: string;
  shippingFilter: string;
  paymentFilter: string;
  dateSelection: ReturnType<typeof adminDateSelectionFromQuery>;
  sourceFilter: string;
  sourceSlugFilter: string;
};

/** The filters a deep link opens the list under. */
export function initialOrderListFilters(pageQuery: URLSearchParams): OrderListFilters {
  return {
    search: pageQuery.get("search") || "",
    shippingFilter: pageQuery.get("status") || pageQuery.get("shipping_status") || "all",
    paymentFilter: "all",
    dateSelection: adminDateSelectionFromQuery(pageQuery),
    sourceFilter: "all",
    sourceSlugFilter: pageQuery.get("source_slug") || "all",
  };
}

/** The `GET /api/admin/orders` query for one page of the list. */
export function orderListQuery(filters: OrderListFilters, page: number, withSourceOptions: boolean) {
  const query = new URLSearchParams({ page: String(page), limit: "20" });
  const search = filters.search.trim();
  if (search) query.set("search", search);
  if (filters.shippingFilter !== "all") query.set("shipping_status", filters.shippingFilter);
  if (filters.paymentFilter !== "all") query.set("payment_status", filters.paymentFilter);
  if (filters.dateSelection.filter !== "all") {
    query.set("date_filter", filters.dateSelection.filter);
    if (filters.dateSelection.filter === ADMIN_CUSTOM_DATE_FILTER) {
      query.set("date_start", filters.dateSelection.start);
      query.set("date_end", filters.dateSelection.end);
    }
  }
  if (filters.sourceFilter !== "all") query.set("source", filters.sourceFilter);
  if (filters.sourceSlugFilter !== "all") query.set("source_slug", filters.sourceSlugFilter);
  if (withSourceOptions) query.set("source_options", "1");
  return query;
}
