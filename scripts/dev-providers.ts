/**
 * Local stand-ins for Mengantar and AutoLaris, for `npm run dev:local`.
 *
 * Without them a local store cannot quote shipping, so checkout, dispatch and
 * online payment can only be exercised against the real providers. They speak
 * the same wire shapes the product's clients parse (`mengantar-client.ts`,
 * `autolaris-client.ts`); `src/lib/dev-providers.test.ts` drives the real
 * clients against this server, so a drift in either side fails `npm test`.
 *
 * Development only. Nothing in `src/` imports this file; a Worker reaches it
 * solely because `dev:local` points `MENGANTAR_BASE_URL` / `AUTOLARIS_BASE_URL`
 * at 127.0.0.1. Prices are deterministic fakes, not quotes.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { indonesiaDistricts } from "../src/data/indonesia-districts.ts";
import { isAutoLarisCheckoutChannel } from "../src/lib/autolaris-client.ts";
import { calculatePaymentAdminFee } from "../src/lib/payment-fee-policy.ts";

type Json = Record<string, unknown> | unknown[];

const COURIERS: readonly { code: string; base: number; perKg: number; cod: boolean }[] = [
  { code: "JNE", base: 11000, perKg: 4000, cod: true },
  { code: "SiCepat", base: 9500, perKg: 3500, cod: true },
  { code: "J&T", base: 10000, perKg: 3800, cod: true },
  { code: "SAP", base: 10500, perKg: 3600, cod: true },
  { code: "Anteraja", base: 9000, perKg: 3400, cod: true },
  { code: "IDexpress", base: 8500, perKg: 3300, cod: true },
  { code: "Paxel", base: 14000, perKg: 5000, cod: false },
  // Keyed as the live /order/estimate returns them (observed 2026-09-25).
  { code: "lion", base: 12000, perKg: 4200, cod: true },
  { code: "pos", base: 10000, perKg: 3900, cod: true },
  { code: "spx", base: 9800, perKg: 3500, cod: true },
];

const normalize = (value: string) =>
  value.toLocaleLowerCase("id-ID").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Provider-shaped area rows from the real district index, ids stable per row. */
export function searchDevAreas(keyword: string, limit = 20) {
  const tokens = normalize(keyword).split(" ").filter(Boolean);
  if (tokens.length === 0) return [];
  const rows = [];
  for (let index = 0; index < indonesiaDistricts.length && rows.length < limit; index += 1) {
    const [district, city, province] = indonesiaDistricts[index];
    const haystack = normalize(`${district} ${city} ${province}`).split(" ");
    if (tokens.every((token) => haystack.some((word) => word.startsWith(token)))) {
      rows.push({
        _id: `dev-area-${index + 1}`,
        DISTRICT_NAME: district,
        SUBDISTRICT_NAME: district,
        CITY_NAME: city,
        PROVINCE_NAME: province,
        ZIP_CODE: "",
      });
    }
  }
  return rows;
}

/**
 * Per-courier delivery history for a phone, derived from its digits so one
 * number always answers the same and different numbers land in different risk
 * bands: the last digit picks the delivered share (0 → no history at all).
 */
export function devReceiverScore(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const last = Number(digits.at(-1) ?? 0);
  // No history: empty couriers and a null summary, as the provider documents.
  if (!digits || last === 0) return { JNE: {}, SiCepat: {}, summary: { average_number: null, average_score: "-" } };
  const share = [0, 0.95, 0.9, 0.8, 0.72, 0.6, 0.5, 0.42, 0.3, 0.15][last];
  const couriers = ["JNE", "SiCepat", "J&T"].map((courier, index) => {
    const total = 4 + ((last + index * 3) % 7);
    const delivered = Math.round(total * share);
    const rate = Math.round((delivered / total) * 100) / 10;
    return [courier, { total, delivered, rts: total - delivered, undelivered: 0, inProgress: index === 0 ? 1 : 0, value: total * 100_000, rate }] as const;
  });
  // `summary` mirrors the provider: unweighted mean of courier rates (0–10)
  // and its letter grade.
  const average = Math.round((couriers.reduce((sum, [, row]) => sum + row.rate, 0) / couriers.length) * 10) / 10;
  const grades = ["E-", "E", "D-", "D", "C-", "C", "B-", "B", "A-", "A"];
  const grade = grades[Math.min(9, Math.floor(average))];
  return { ...Object.fromEntries(couriers), summary: { average_number: average, average_score: grade } };
}

function areaNumber(id: string) {
  return Number(/(\d+)$/.exec(id)?.[1] ?? 0);
}

export function estimateDevRates(originId: string, destinationId: string, weightKg: number, codAmount: number) {
  const distance = Math.abs(areaNumber(originId) - areaNumber(destinationId)) % 9;
  const kg = Math.max(1, Math.ceil(weightKg));
  const data: Record<string, unknown> = {};
  for (const courier of COURIERS) {
    const price = Math.round((courier.base + courier.perKg * (kg - 1) + distance * 1000) / 500) * 500;
    data[courier.code] = {
      price,
      estimate_delivery: `${2 + (distance % 3)}-${3 + (distance % 3)}`,
      unsupported: false,
      unsupported_cod: !courier.cod,
      // Mengantar's own figure only appears when COD_AMOUNT is sent, which the
      // store never does at checkout (shipping-quote.ts); mirrored here.
      codFee: codAmount > 0 && courier.cod ? Math.round(codAmount * 0.03) : 0,
    };
  }
  return data;
}

function jakartaIn(hours: number) {
  const date = new Date(Date.now() + hours * 3_600_000 + 7 * 3_600_000);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {} as Record<string, unknown>;
  const type = String(request.headers["content-type"] || "");
  if (type.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw)) as Record<string, unknown>;
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

function send(response: ServerResponse, status: number, body: Json) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export function createDevProviderServer(): Server {
  const pickupAddresses: Record<string, string>[] = [];
  const pickupTimes: Array<{ _id: string; address: string; date: string; time: string }> = [];
  const shipments = new Map<string, Record<string, unknown>>();
  const payments = new Map<string, { paid: boolean; total: number; receiver?: string; channel?: string }>();
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(sequence += 1)}`;

  return createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const method = request.method || "GET";

    // ---- AutoLaris: /api/h2h/* ------------------------------------------
    if (url.pathname === "/api/h2h/list_payment") {
      return send(response, 200, {
        rc: "00",
        ket: "SUCCESS",
        data: ["QRIS", "VABCA", "VAMANDIRI", "VABNI", "VABRI", "VAPERMATA"].map((channel_code) => ({ channel_code })),
      });
    }
    if (url.pathname === "/api/h2h/submit" && method === "POST") {
      const body = await readBody(request);
      const amount = Number(body.grand_total) || 0;
      // The fee table the store itself shows the buyer, so the local
      // instruction never disagrees with the checkout or invoice label.
      const channel = String(body.channel_code);
      const admin = isAutoLarisCheckoutChannel(channel) ? calculatePaymentAdminFee(channel, amount) : 0;
      const transactionId = String(Date.now()) + String((sequence += 1));
      payments.set(transactionId, { paid: false, total: amount + admin, receiver: String(body.receiver_name || ""), channel: String(body.channel_code || "") });
      const qris = String(body.channel_code) === "QRIS";
      return send(response, 200, {
        rc: "00",
        ket: "SUCCESS",
        data: {
          transaction_id: transactionId,
          biaya_admin: admin,
          total: amount + admin,
          payment_info: {
            ...(qris
              ? { qr: `00020101021226DEV${transactionId}5303360540${amount + admin}6304ABCD` }
              : { va: `8808${transactionId.slice(-10)}` }),
            expired: jakartaIn(24),
          },
        },
      });
    }
    if (url.pathname === "/api/h2h/advice" && method === "POST") {
      const body = await readBody(request);
      const payment = payments.get(String(body.transaction_id));
      if (!payment) return send(response, 200, { rc: "14", ket: "TRANSAKSI TIDAK DITEMUKAN", data: {} });
      return send(response, 200, payment.paid
        ? { rc: "00", ket: "PAID", data: { awb: "" } }
        : { rc: "02", ket: "PENDING", data: { awb: "" } });
    }
    // Local-only lever: settle a transaction so the hourly reconciliation
    // (or `curl` against /cdn-cgi/handler/scheduled) has something to find.
    // Local-only: list what the stand-in holds, so a script can find the
    // transaction to settle (the store never returns a transaction id).
    if (url.pathname === "/__dev/autolaris/payments" && method === "GET") {
      return send(response, 200, [...payments].map(([transaction_id, payment]) => ({ transaction_id, ...payment })));
    }
    if (url.pathname === "/__dev/autolaris/pay" && method === "POST") {
      const payment = payments.get(url.searchParams.get("transaction_id") || "");
      if (!payment) return send(response, 404, { ok: false });
      payment.paid = true;
      return send(response, 200, { ok: true });
    }

    // ---- Mengantar: /api/public/<key>/* ---------------------------------
    const mengantar = /^\/api\/public\/[^/]+(\/.*)$/.exec(url.pathname);
    if (mengantar) {
      const path = mengantar[1];
      if (path === "/address/search") {
        return send(response, 200, { success: true, data: searchDevAreas(url.searchParams.get("keyword") || "") });
      }
      if (path === "/address" && method === "GET") {
        return send(response, 200, { success: true, data: pickupAddresses });
      }
      if (path === "/address" && method === "POST") {
        const body = await readBody(request);
        const id = String(body._id || "") || nextId("dev-pickup-");
        const row = {
          _id: id,
          PICKUP_NAME: String(body.PICKUP_NAME || ""),
          PICKUP_PIC: String(body.PICKUP_PIC || ""),
          PICKUP_PIC_PHONE: String(body.PICKUP_PIC_PHONE || ""),
          PICKUP_ADDRESS: String(body.PICKUP_ADDRESS || ""),
        };
        const existing = pickupAddresses.findIndex((address) => address._id === id);
        if (existing >= 0) pickupAddresses[existing] = row;
        else pickupAddresses.push(row);
        return send(response, 200, { success: true, data: row });
      }
      // Mengantar docs: POST /time answers one slot object, GET /time an
      // array of the address's slots; a slot is one hour, 9:00–18:00.
      if (path === "/time") {
        if (method === "POST") {
          const body = await readBody(request);
          const time = String(body.time || "");
          if (!/^(9|1[0-8]):00$/.test(time) || !/^\d{2}-\d{2}-\d{4}$/.test(String(body.date || ""))) {
            return send(response, 400, { success: false, message: "Invalid pickup date or time slot." });
          }
          const slot = { _id: nextId("dev-time-"), address: String(body.address_id || ""), date: String(body.date), time };
          pickupTimes.push(slot);
          return send(response, 200, { success: true, data: slot });
        }
        const address = url.searchParams.get("address") || "";
        return send(response, 200, { success: true, data: pickupTimes.filter((slot) => slot.address === address) });
      }
      if (path === "/order/estimate") {
        return send(response, 200, {
          success: true,
          data: estimateDevRates(
            url.searchParams.get("origin_id") || "",
            url.searchParams.get("destination_id") || "",
            Number(url.searchParams.get("weight")) || 1,
            Number(url.searchParams.get("COD_AMOUNT")) || 0,
          ),
        });
      }
      if (path === "/order" && method === "POST") {
        const body = await readBody(request);
        const pickup = (body.pickup || {}) as Record<string, unknown>;
        if (pickup.type === "scheduledPickup" && (!pickupTimes.some((slot) => slot._id === pickup.time_id) || !["volumeMotor", "volumeMobil", "volumeTruck"].includes(String(pickup.volume)))) {
          return send(response, 400, { success: false, message: "scheduledPickup needs a known time_id and a volume." });
        }
        if (pickup.type !== "scheduledPickup" && pickup.type !== "dropOff") {
          return send(response, 400, { success: false, message: "pickup.type must be scheduledPickup or dropOff." });
        }
        const id = nextId("dev-order-");
        const cnote = `DEV${Date.now().toString().slice(-10)}`;
        const row = { _id: id, ORDER_ID: id.toUpperCase(), cnote_no: cnote, isPaid: true, status: "Order Created", payload: body };
        shipments.set(cnote, row);
        return send(response, 200, { success: true, batch_id: nextId("dev-batch-"), data: [row] });
      }
      if (path === "/order" && method === "GET") {
        const shipment = shipments.get(url.searchParams.get("tracking_id") || "");
        return send(response, 200, {
          success: true,
          data: shipment
            ? [{ cnote_no: shipment.cnote_no, ORDER_ID: shipment.ORDER_ID, status: shipment.status, history: [] }]
            : [],
        });
      }
      if (path === "/getReceiverScoreByNumberUser") {
        return send(response, 200, { success: true, data: devReceiverScore(url.searchParams.get("search") || "") });
      }
      return send(response, 404, { success: false, message: `dev-providers: ${method} ${path} is not simulated` });
    }

    if (url.pathname === "/") {
      return send(response, 200, {
        name: "AdsBookCMS dev providers",
        mengantar: "/api/public/<any-key>/…",
        autolaris: "/api/h2h/…",
        settle: "POST /__dev/autolaris/pay?transaction_id=…",
      });
    }
    return send(response, 404, { error: "not found" });
  });
}

export function startDevProviders(port: number): Promise<Server> {
  const server = createDevProviderServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.DEV_PROVIDERS_PORT) || 8788;
  await startDevProviders(port);
  console.log(`dev providers on http://127.0.0.1:${port}`);
}
