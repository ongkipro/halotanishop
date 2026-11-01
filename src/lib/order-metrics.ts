/**
 * How a report counts an order (PRD A37, REQ-206). The dashboard
 * (`/api/admin/analytics`) and the Analitik menu (`/api/admin/insights/*`)
 * both import these, so a card and a ranking cannot disagree on what an order
 * or its revenue is.
 *
 * - An `abandoned` row is a lead: a buyer who started a form and did not
 *   finish. It is never an order and never revenue.
 * - A released order no longer represents money in play: a cancelled or
 *   returned shipment (its COD money never arrives) or a cancelled, refunded
 *   or failed payment. It still counts as an order placed; it is excluded from
 *   live revenue.
 *
 * `order-lifecycle.ts` holds the same released set for its own writes with an
 * `o.` prefix. It is a protected surface (TASKS.md, A35–A43) and is not
 * edited to import this; `insights.test.ts` asserts the two still agree.
 */

/** A row that is a lead, not an order. `alias` is a table prefix such as `o.`. */
export const leadRowSql = (alias = "") => `${alias}shipping_status = 'abandoned'`;

/** A row that is an order: everything that is not a lead. */
export const orderRowSql = (alias = "") => `${alias}shipping_status <> 'abandoned'`;

/** An order that no longer represents money in play. */
export const releasedOrderSql = (alias = "") =>
  `${alias}shipping_status IN ('cancelled', 'returned') OR ${alias}payment_status IN ('cancelled', 'refunded', 'failed')`;

export const LEAD_ROW = leadRowSql();
export const ORDER_ROW = orderRowSql();
export const RELEASED_ORDER = releasedOrderSql();
