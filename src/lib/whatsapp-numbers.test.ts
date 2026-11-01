import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { pickThanksWhatsapp } from "./thanks-whatsapp.ts";
import {
  activeThanksNumbers,
  addWhatsappNumber,
  listWhatsappNumbers,
  normalizeWhatsappPhone,
  removeWhatsappNumber,
  updateWhatsappNumber,
  WHATSAPP_NUMBERS_MAX,
  WhatsappNumberError,
} from "./whatsapp-numbers.ts";

// By suffix, never by number (RELEASE.md): an install with its own migrations
// renumbers the product's above them, and a fixed number would miss the file.
const migrationUrl = (suffix: string) => {
  const dir = new URL("../db/migrations/", import.meta.url);
  const name = readdirSync(dir).find((file) => file.endsWith(suffix));
  if (!name) throw new Error(`no migration ends with ${suffix}`);
  return new URL(name, dir);
};


type SqlValue = null | number | string;

const MIGRATION = readFileSync(
  migrationUrl("_whatsapp_numbers.sql"),
  "utf8",
).replace(/--> statement-breakpoint/g, "");

class Statement {
  readonly sqlite: DatabaseSync;
  readonly sql: string;
  readonly values: SqlValue[];
  constructor(sqlite: DatabaseSync, sql: string, values: SqlValue[] = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.values = values;
  }
  bind(...values: SqlValue[]) {
    return new Statement(this.sqlite, this.sql, values);
  }
  async first<T>() {
    return (this.sqlite.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
  async all<T>() {
    return { success: true, results: this.sqlite.prepare(this.sql).all(...this.values) as T[], meta: {} };
  }
  async run() {
    return this.execute();
  }
  execute() {
    const info = this.sqlite.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: Number(info.changes) } };
  }
}

/** D1 over node:sqlite, with `batch` as one transaction like D1's. */
function createDatabase(supportWhatsapp: string | null = "081234567890") {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE stores (id INTEGER PRIMARY KEY, support_whatsapp TEXT)");
  sqlite.prepare("INSERT INTO stores (id, support_whatsapp) VALUES (1, ?)").run(supportWhatsapp);
  sqlite.exec(MIGRATION);
  const database = {
    prepare: (sql: string) => new Statement(sqlite, sql),
    async batch(statements: Statement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  const mirror = () =>
    (sqlite.prepare("SELECT support_whatsapp FROM stores WHERE id = 1").get() as { support_whatsapp: string })
      .support_whatsapp;
  return { sqlite, database, mirror };
}

async function rejectsWith(promise: Promise<unknown>, status: number, message: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof WhatsappNumberError, String(error));
    assert.equal(error.status, status);
    assert.match(error.message, message);
    return true;
  });
}

test("a number is normalised to the wa.me form /thanks can open, or refused", () => {
  assert.equal(normalizeWhatsappPhone("0812-3456-7890"), "6281234567890");
  assert.equal(normalizeWhatsappPhone("+62 812 3456 7890"), "6281234567890");
  assert.equal(normalizeWhatsappPhone("6281234567890"), "6281234567890");
  assert.equal(normalizeWhatsappPhone("0812"), null, "too short");
  assert.equal(normalizeWhatsappPhone("+1 415 555 0100"), null, "not an Indonesian number");
  assert.equal(normalizeWhatsappPhone(""), null);
  assert.equal(normalizeWhatsappPhone(undefined), null);
});

test("the migration seeds an upgrading store's number and skips one /thanks could not use", async () => {
  const seeded = createDatabase("0812 3456 7890");
  assert.deepEqual(await listWhatsappNumbers(seeded.database), [
    { id: 1, label: "", phone: "6281234567890", is_active: true },
  ]);

  for (const unusable of [null, "", "+1 415 555 0100", "0812"]) {
    const { database } = createDatabase(unusable);
    assert.deepEqual(await listWhatsappNumbers(database), [], `seed skipped for ${JSON.stringify(unusable)}`);
  }
});

test("adding, editing and removing keep the store's support number on the first active one", async () => {
  const { database, mirror } = createDatabase("081234567890");
  await addWhatsappNumber(database, { label: "CS Sore", phone: "0898-7654-3210" });
  assert.equal(mirror(), "6281234567890", "first active is still the seeded number");

  const [first, second] = await listWhatsappNumbers(database);
  await updateWhatsappNumber(database, first.id, { is_active: false });
  assert.equal(mirror(), second.phone, "deactivating the first moves the mirror");

  await updateWhatsappNumber(database, second.id, { label: "CS Malam" });
  assert.equal((await listWhatsappNumbers(database))[1].label, "CS Malam");

  await removeWhatsappNumber(database, first.id);
  assert.deepEqual((await listWhatsappNumbers(database)).map((row) => row.phone), [second.phone]);
});

test("the last active number cannot be deactivated or removed", async () => {
  const { database, mirror } = createDatabase("081234567890");
  const [only] = await listWhatsappNumbers(database);
  await rejectsWith(updateWhatsappNumber(database, only.id, { is_active: false }), 409, /Minimal satu nomor/);
  await rejectsWith(removeWhatsappNumber(database, only.id), 409, /Minimal satu nomor/);
  assert.equal((await listWhatsappNumbers(database))[0].is_active, true);
  assert.equal(mirror(), "6281234567890");

  // An inactive number can always go.
  await addWhatsappNumber(database, { phone: "089876543210" });
  const added = (await listWhatsappNumbers(database))[1];
  await updateWhatsappNumber(database, added.id, { is_active: false });
  await removeWhatsappNumber(database, added.id);
  assert.equal((await listWhatsappNumbers(database)).length, 1);
});

test("duplicates, unusable numbers, long labels, an unknown id and an eleventh number are refused", async () => {
  const { database } = createDatabase("081234567890");
  await rejectsWith(addWhatsappNumber(database, { phone: "+62 812 3456 7890" }), 409, /sudah ada/);
  await rejectsWith(addWhatsappNumber(database, { phone: "12345" }), 422, /nomor Indonesia/);
  await rejectsWith(addWhatsappNumber(database, { phone: "089876543210", label: "x".repeat(61) }), 422, /Label/);
  await rejectsWith(updateWhatsappNumber(database, 999, { label: "x" }), 404, /tidak ditemukan/);
  await rejectsWith(removeWhatsappNumber(database, 999), 404, /tidak ditemukan/);

  for (let index = 1; index < WHATSAPP_NUMBERS_MAX; index += 1) {
    await addWhatsappNumber(database, { phone: `0811000000${String(index).padStart(2, "0")}` });
  }
  assert.equal((await listWhatsappNumbers(database)).length, WHATSAPP_NUMBERS_MAX);
  await rejectsWith(addWhatsappNumber(database, { phone: "081199999999" }), 409, /Maksimal 10/);
  assert.equal((await listWhatsappNumbers(database)).length, WHATSAPP_NUMBERS_MAX);
});

test("/thanks reads the active numbers in order, else the legacy store number, else none", async () => {
  const { database } = createDatabase("081234567890");
  await addWhatsappNumber(database, { phone: "089876543210" });
  await addWhatsappNumber(database, { phone: "081300000000" });
  const third = (await listWhatsappNumbers(database))[2];
  await updateWhatsappNumber(database, third.id, { is_active: false });
  assert.deepEqual(await activeThanksNumbers(database), ["6281234567890", "6289876543210"]);

  // A store whose number the migration could not seed still has its button.
  const legacy = createDatabase("0812 0000 1111");
  legacy.sqlite.exec("DELETE FROM whatsapp_numbers");
  assert.deepEqual(await activeThanksNumbers(legacy.database), ["6281200001111"]);

  const none = createDatabase(null);
  assert.deepEqual(await activeThanksNumbers(none.database), []);

  const failing = { prepare() { throw new Error("D1 down"); } } as unknown as D1Database;
  const error = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await activeThanksNumbers(failing), []);
  } finally {
    console.error = error;
  }
});

test("each order gets one fixed number, and the split is even over many orders", () => {
  const two = ["6281100000001", "6281100000002"];
  const three = [...two, "6281100000003"];

  assert.equal(pickThanksWhatsapp(["6281100000001"], "INV-10001"), "6281100000001");
  assert.equal(pickThanksWhatsapp([], "INV-10001"), null);
  assert.equal(pickThanksWhatsapp(["+1 415 555 0100"], "INV-10001"), null, "an unusable number is never picked");
  assert.equal(
    pickThanksWhatsapp(["+1 415 555 0100", "6281100000002"], "INV-10001"),
    "6281100000002",
  );
  for (const order of ["INV-10001", "INV-10002", "ABN-00042"]) {
    assert.equal(pickThanksWhatsapp(three, order), pickThanksWhatsapp(three, order), "stable per order");
  }
  assert.equal(pickThanksWhatsapp(three, "", () => 0.99), three[2], "random only without an order number");

  // Measured 2026-10-29 over INV-10001..INV-11000: 50.1/49.9 and
  // 34.1/32.4/33.5. Three points of slack, not an exact alternation.
  for (const numbers of [two, three]) {
    const counts = new Map<string, number>();
    for (let index = 0; index < 1000; index += 1) {
      const phone = pickThanksWhatsapp(numbers, `INV-${10001 + index}`)!;
      counts.set(phone, (counts.get(phone) ?? 0) + 1);
    }
    assert.equal(counts.size, numbers.length, "every number receives orders");
    for (const count of counts.values()) {
      const share = (count / 1000) * 100;
      assert.ok(Math.abs(share - 100 / numbers.length) <= 3, `share ${share}% for ${numbers.length} numbers`);
    }
  }
});
