/**
 * The `adsbook` CLI (PRD A45, REQ-260): a client of the operations API only
 * (`docs/OPS-API.md`). `scripts/adsbook.ts` wires it to the process; this
 * module takes its I/O as arguments so `ops-api.test.ts` can run it against the
 * real route handlers.
 *
 * The key is stored in `~/.config/adsbook/credentials.json`, mode 0600, and is
 * never written to stdout or stderr.
 */
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

export type CliIo = {
  argv: string[];
  home: string;
  fetch: typeof fetch;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** The key when `login` gets no `--key`: piped stdin or a hidden prompt. */
  readSecret: (prompt: string) => Promise<string>;
};

type Credentials = { url: string; key: string };

const USAGE = `adsbook — AdsBookCMS operations API client

  adsbook login --url <https://toko.example> [--key <key>]
  adsbook logout
  adsbook orders list [filters] [--json]
  adsbook orders show <number> [--json]

orders list filters:
  --kind order|lead|all   --status <s>   --payment-method <m>   --payment-status <s>
  --date-filter <f>       --date-start <YYYY-MM-DD>   --date-end <YYYY-MM-DD>
  --source-slug <slug>    --utm-campaign <c>   --updated-since <ISO-8601>
  --limit <1-100>         --cursor <next_cursor>

Without --key, login reads the key from stdin or asks for it without echoing.
`;

const LIST_FILTERS = [
  "kind", "status", "payment-method", "payment-status", "date-filter", "date-start",
  "date-end", "source-slug", "utm-campaign", "updated-since", "limit", "cursor",
] as const;

class CliError extends Error {}

export function credentialsPath(home: string) {
  return path.join(home, ".config", "adsbook", "credentials.json");
}

async function readCredentials(home: string): Promise<Credentials> {
  let parsed: Partial<Credentials>;
  try {
    parsed = JSON.parse(await readFile(credentialsPath(home), "utf8"));
  } catch {
    throw new CliError("Belum login. Jalankan: adsbook login --url <https://toko.example>");
  }
  if (typeof parsed.url !== "string" || typeof parsed.key !== "string") {
    throw new CliError(`${credentialsPath(home)} rusak. Jalankan adsbook login lagi.`);
  }
  return { url: parsed.url, key: parsed.key };
}

/** The store origin, `https:` only except a local dev host. */
export function normalizeStoreUrl(value: string) {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new CliError(`URL toko tidak valid: ${value}`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new CliError("URL toko harus https:// (http:// hanya untuk localhost).");
  }
  return url.origin;
}

async function request(io: CliIo, credentials: Credentials, pathAndQuery: string) {
  let response: Response;
  try {
    response = await io.fetch(`${credentials.url}/api/ops/v1${pathAndQuery}`, {
      headers: { authorization: `Bearer ${credentials.key}`, accept: "application/json" },
    });
  } catch (error) {
    throw new CliError(`Tidak dapat menghubungi ${credentials.url}: ${error instanceof Error ? error.message : error}`);
  }
  const body = (await response.json().catch(() => null)) as Record<string, any> | null;
  if (!response.ok || !body) {
    const code = body?.error?.code ? ` [${body.error.code}]` : "";
    throw new CliError(`${response.status}${code} ${body?.error?.message ?? response.statusText}`);
  }
  return body;
}

const rupiah = new Intl.NumberFormat("id-ID");
// `sv-SE` writes `YYYY-MM-DD HH:mm`; the store's day is the Jakarta day.
const jakarta = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});
const localTime = (value: unknown) => {
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value ?? "-") : `${jakarta.format(date)} WIB`;
};

function table(rows: string[][]) {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd()).join("\n");
}

function orderRows(orders: Record<string, any>[]) {
  return table([
    ["NOMOR", "DIBUAT", "STATUS", "BAYAR", "TOTAL", "SUMBER"],
    ...orders.map((order) => [
      String(order.number),
      localTime(order.created_at),
      `${order.status.shipping}${order.void ? " (void)" : ""}`,
      `${order.payment.method ?? "-"}/${order.payment.status ?? "-"}`,
      rupiah.format(order.amounts.total),
      order.attribution.source_slug ?? order.attribution.traffic_source,
    ]),
  ]);
}

function orderDetail(order: Record<string, any>) {
  const lines = [
    `${order.number}  ${order.kind}${order.void ? "  VOID" : ""}`,
    `Dibuat     ${localTime(order.created_at)} · diubah ${localTime(order.updated_at)}`,
    `Status     ${order.status.shipping} · bayar ${order.payment.method ?? "-"}/${order.payment.status ?? "-"}`,
    `Kirim      ${[order.shipping.courier, order.shipping.service, order.shipping.resi].filter(Boolean).join(" ") || "-"}`,
    `Tujuan     ${[order.destination.district, order.destination.city, order.destination.province].filter(Boolean).join(", ")}`,
  ];
  if (order.customer) {
    lines.push(`Pembeli    ${order.customer.name ?? "-"} · ${order.customer.phone ?? "-"}`);
    lines.push(`Alamat     ${order.customer.address ?? "-"} ${order.customer.postal_code ?? ""}`.trimEnd());
  }
  const utm = Object.entries(order.attribution.utm).filter(([, value]) => value);
  lines.push(
    `Sumber     ${order.attribution.source_slug ?? "-"} · ${order.attribution.traffic_source}` +
      (utm.length ? ` · ${utm.map(([key, value]) => `${key}=${value}`).join(" ")}` : ""),
  );
  lines.push("", table([
    ["PRODUK", "QTY", "HARGA", "BERAT"],
    ...order.items.map((item: Record<string, any>) => [
      [item.product, item.variant].filter(Boolean).join(" — ") || "-",
      String(item.quantity),
      rupiah.format(item.unit_price),
      item.weight_grams === null ? "-" : `${item.weight_grams} g`,
    ]),
  ]), "");
  const amounts = order.amounts;
  for (const [label, value] of [
    ["Produk", amounts.items], ["Diskon", -amounts.discount], ["Ongkir", amounts.shipping],
    ["Biaya COD", amounts.cod_fee], ["Total", amounts.total],
  ] as const) {
    if (value || label === "Total") lines.push(`${label.padEnd(10)} ${rupiah.format(value)}`);
  }
  return lines.join("\n");
}

async function login(io: CliIo, args: string[]) {
  const { values } = parseArgs({ args, options: { url: { type: "string" }, key: { type: "string" } } });
  if (!values.url) throw new CliError("Wajib: --url <https://toko.example>");
  const url = normalizeStoreUrl(values.url);
  const key = (values.key ?? (await io.readSecret("API key: "))).trim();
  if (!key) throw new CliError("API key kosong.");
  // lazy: the contract needs `ops:orders:read`, the scope every CLI command
  // uses today; a catalogue-only key (A-441) needs a check that accepts any ops scope.
  await request(io, { url, key }, "/openapi.json");
  const file = credentialsPath(io.home);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify({ url, key }, null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600); // an existing file keeps its old mode on write
  io.stdout(`Login ke ${url} tersimpan di ${file}.\n`);
}

async function orders(io: CliIo, args: string[]) {
  const [action, ...rest] = args;
  const options = {
    json: { type: "boolean" },
    ...Object.fromEntries(LIST_FILTERS.map((name) => [name, { type: "string" }])),
  } as const;
  const { values, positionals } = parseArgs({ args: rest, options, allowPositionals: true }) as {
    values: Record<string, string | boolean | undefined>;
    positionals: string[];
  };
  const credentials = await readCredentials(io.home);
  if (action === "list") {
    if (positionals.length) throw new CliError(`Argumen tidak dikenal: ${positionals.join(" ")}`);
    const query = new URLSearchParams();
    for (const name of LIST_FILTERS) {
      const value = values[name];
      if (typeof value === "string") query.set(name.replace(/-/g, "_"), value);
    }
    const page = await request(io, credentials, `/orders${query.size ? `?${query}` : ""}`);
    if (values.json) io.stdout(`${JSON.stringify(page.data, null, 2)}\n`);
    else io.stdout(page.data.length ? `${orderRows(page.data)}\n` : "Tidak ada order.\n");
    if (page.next_cursor) io.stderr(`Halaman berikutnya: --cursor ${page.next_cursor}\n`);
    return;
  }
  if (action === "show") {
    if (positionals.length !== 1) throw new CliError("Pakai: adsbook orders show <nomor>");
    const { data } = await request(io, credentials, `/orders/${encodeURIComponent(positionals[0])}`);
    io.stdout(values.json ? `${JSON.stringify(data, null, 2)}\n` : `${orderDetail(data)}\n`);
    return;
  }
  throw new CliError("Pakai: adsbook orders list|show");
}

/** Runs one command; the exit code is the return value. */
export async function runAdsbookCli(io: CliIo): Promise<number> {
  const [command, ...args] = io.argv;
  try {
    if (!command || command === "help" || command === "--help" || command === "-h") {
      io.stdout(USAGE);
      return command ? 0 : 1;
    }
    if (command === "login") await login(io, args);
    else if (command === "logout") {
      await rm(credentialsPath(io.home), { force: true });
      io.stdout("Logout: kredensial dihapus.\n");
    } else if (command === "orders") await orders(io, args);
    else throw new CliError(`Perintah tidak dikenal: ${command}\n\n${USAGE}`);
    return 0;
  } catch (error) {
    // parseArgs and CliError messages carry no secret; anything else is reduced to its message.
    io.stderr(`adsbook: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
