import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import {
  ensureSchemaUpgraded,
  SchemaUpgradeError,
  splitMigrationStatements,
  type MigrationSource,
} from "./schema-version.ts";
import { CMS_VERSION } from "./version.ts";

class FakeStatement {
  readonly database: FakeMigrationDatabase;
  readonly sql: string;
  readonly values: unknown[];

  constructor(
    database: FakeMigrationDatabase,
    sql: string,
    values: unknown[] = [],
  ) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new FakeStatement(this.database, this.sql, values);
  }

  async run() {
    return this.database.run(this);
  }

  async all<T>() {
    return this.database.all(this) as Promise<{ results: T[] }>;
  }
}

class FakeMigrationDatabase {
  history: string[] = [];
  effects: string[] = [];
  migrationTable = false;
  private writeQueue: Promise<unknown> = Promise.resolve();
  private barrierRemaining = 0;
  private releaseReads: (() => void) | null = null;
  private readBarrier: Promise<void> = Promise.resolve();

  readonly binding = {
    prepare: (sql: string) => new FakeStatement(this, sql),
    batch: (statements: unknown[]) =>
      this.batch(statements as FakeStatement[]),
    withSession: () => ({
      prepare: (sql: string) => new FakeStatement(this, sql),
      batch: (statements: unknown[]) =>
        this.batch(statements as FakeStatement[]),
    }),
  } as unknown as D1Database;

  synchronizeNextHistoryReads(count: number) {
    this.barrierRemaining = count;
    this.readBarrier = new Promise<void>((resolve) => {
      this.releaseReads = resolve;
    });
  }

  async run(statement: FakeStatement) {
    if (/CREATE TABLE IF NOT EXISTS d1_migrations/i.test(statement.sql)) {
      this.migrationTable = true;
      return { meta: { changes: 0 } };
    }
    throw new Error(`unexpected run: ${statement.sql}`);
  }

  async all(statement: FakeStatement) {
    assert.match(statement.sql, /SELECT name FROM d1_migrations/i);
    if (!this.migrationTable) throw new Error("missing migration table");
    const snapshot = this.history.map((name) => ({ name }));
    if (this.barrierRemaining > 0) {
      this.barrierRemaining -= 1;
      if (this.barrierRemaining === 0) this.releaseReads?.();
      await this.readBarrier;
    }
    return { results: snapshot };
  }

  batch(statements: FakeStatement[]) {
    const execute = async () => {
      const history = [...this.history];
      const effects = [...this.effects];
      for (const statement of statements) {
        if (/INSERT INTO d1_migrations/i.test(statement.sql)) {
          const name = String(statement.values[0]);
          if (history.includes(name)) throw new Error("duplicate migration");
          history.push(name);
          continue;
        }
        if (/BROKEN/i.test(statement.sql)) throw new Error("migration failed");
        effects.push(statement.sql.replace(/\s+/g, " ").trim());
      }
      this.history = history;
      this.effects = effects;
      return statements.map(() => ({ meta: { changes: 1 } }));
    };
    const result = this.writeQueue.then(execute, execute);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const chain = (...sql: string[]): MigrationSource[] =>
  sql.map((statement, index) => ({
    name: `${String(index).padStart(4, "0")}_test_${index}.sql`,
    sql: statement,
  }));

test("a behind database upgrades in order and a second boot is idempotent", async () => {
  const fake = new FakeMigrationDatabase();
  const migrations = chain(
    "CREATE TABLE first (id INTEGER);",
    "ALTER TABLE first ADD COLUMN name TEXT;",
    "CREATE INDEX first_name_idx ON first(name);",
  );

  const first = await ensureSchemaUpgraded(fake.binding, {
    migrations,
    expected: migrations.length,
    cache: false,
  });
  const second = await ensureSchemaUpgraded(fake.binding, {
    migrations,
    expected: migrations.length,
    cache: false,
  });

  assert.equal(first.upgraded, 3);
  assert.equal(second.upgraded, 0);
  assert.deepEqual(fake.history, migrations.map((migration) => migration.name));
  assert.deepEqual(fake.effects, [
    "CREATE TABLE first (id INTEGER);",
    "ALTER TABLE first ADD COLUMN name TEXT;",
    "CREATE INDEX first_name_idx ON first(name);",
  ]);
});

test("concurrent boots claim each migration once", async () => {
  const fake = new FakeMigrationDatabase();
  const migrations = chain("CREATE TABLE only_once (id INTEGER);");
  fake.synchronizeNextHistoryReads(2);

  const [left, right] = await Promise.all([
    ensureSchemaUpgraded(fake.binding, {
      migrations,
      expected: 1,
      cache: false,
    }),
    ensureSchemaUpgraded(fake.binding, {
      migrations,
      expected: 1,
      cache: false,
    }),
  ]);

  assert.equal(left.state, "match");
  assert.equal(right.state, "match");
  assert.deepEqual(fake.history, [migrations[0].name]);
  assert.deepEqual(fake.effects, ["CREATE TABLE only_once (id INTEGER);"]);
});

test("a failed migration rolls back its claim and can be retried", async () => {
  const fake = new FakeMigrationDatabase();
  const broken = chain("CREATE TABLE first (id INTEGER);", "BROKEN MIGRATION;");

  await assert.rejects(
    ensureSchemaUpgraded(fake.binding, {
      migrations: broken,
      expected: 2,
      cache: false,
    }),
    (error: unknown) => {
      assert.ok(error instanceof SchemaUpgradeError);
      assert.equal(error.code, "SCHEMA_UPGRADE_APPLY_FAILED");
      assert.equal(error.migration, broken[1].name);
      return true;
    },
  );
  assert.deepEqual(fake.history, [broken[0].name]);
  assert.deepEqual(fake.effects, ["CREATE TABLE first (id INTEGER);"]);

  const repaired = chain(
    "CREATE TABLE first (id INTEGER);",
    "ALTER TABLE first ADD COLUMN recovered TEXT;",
  );
  const retry = await ensureSchemaUpgraded(fake.binding, {
    migrations: repaired,
    expected: 2,
    cache: false,
  });
  assert.equal(retry.upgraded, 1);
  assert.deepEqual(fake.history, repaired.map((migration) => migration.name));
});

test("unknown and ahead migration histories fail closed with stable codes", async () => {
  const unknown = new FakeMigrationDatabase();
  unknown.migrationTable = true;
  unknown.history = ["0000_not_this_bundle.sql"];
  await assert.rejects(
    ensureSchemaUpgraded(unknown.binding, {
      migrations: chain("CREATE TABLE known (id INTEGER);"),
      expected: 1,
      cache: false,
    }),
    (error: unknown) =>
      error instanceof SchemaUpgradeError &&
      error.code === "SCHEMA_UPGRADE_HISTORY_UNKNOWN",
  );

  const ahead = new FakeMigrationDatabase();
  ahead.migrationTable = true;
  ahead.history = ["0000_test_0.sql", "0001_future.sql"];
  await assert.rejects(
    ensureSchemaUpgraded(ahead.binding, {
      migrations: chain("CREATE TABLE known (id INTEGER);"),
      expected: 1,
      cache: false,
    }),
    (error: unknown) =>
      error instanceof SchemaUpgradeError &&
      error.code === "SCHEMA_UPGRADE_DATABASE_AHEAD",
  );
});

test("the SQL lexer preserves triggers and splits markerless migrations safely", () => {
  const migrationUrl = new URL("../db/migrations/", import.meta.url);
  const trigger = readFileSync(new URL("0003_lyrical_luckman.sql", migrationUrl), "utf8");
  const landing = readFileSync(new URL("0027_landing_page_builder.sql", migrationUrl), "utf8");
  const templates = readFileSync(
    new URL("0039_runtime_storefront_templates.sql", migrationUrl),
    "utf8",
  );

  const triggerStatements = splitMigrationStatements(trigger);
  assert.equal(triggerStatements.length, 3);
  assert.match(triggerStatements[2], /SELECT RAISE[\s\S]*END;/);
  assert.equal(splitMigrationStatements(landing).length, 5);
  assert.equal(splitMigrationStatements(templates).length, 2);

  const quoted = splitMigrationStatements(
    "INSERT INTO notes(value) VALUES ('semi;colon'); -- ignored ;\n" +
      "/* ignored ; */ UPDATE notes SET value = \"still;one\";",
  );
  assert.equal(quoted.length, 2);
  assert.throws(() => splitMigrationStatements("SELECT 'unterminated;"));
  assert.throws(() => splitMigrationStatements("SELECT 1; /* unterminated"));
  assert.throws(() => splitMigrationStatements("SELECT 1;;"));
});

test("CMS_VERSION.schemaVersion matches the ordered migration chain on disk", () => {
  const files = readdirSync(new URL("../db/migrations/", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  assert.equal(files.length, CMS_VERSION.schemaVersion);
  files.forEach((name, index) => {
    assert.equal(
      name.slice(0, 4),
      String(index).padStart(4, "0"),
      `migration chain has a gap or duplicate at ${name}`,
    );
    assert.ok(
      splitMigrationStatements(
        readFileSync(new URL(name, new URL("../db/migrations/", import.meta.url)), "utf8"),
      ).length > 0,
    );
  });
});

test("tests find a product migration from 0067 on by its suffix, never by number", async () => {
  // An install with catalogue migrations of its own renumbers the product's
  // above them (zvarashop, 2026-10-31); a test naming "0076_..." then opens a
  // file that does not exist there. 0000-0066 predate every install's own.
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = new URL("./", import.meta.url);
  const offenders = readdirSync(dir)
    .filter((file) => file.endsWith(".test.ts") && file !== "deploy-preflight.test.ts")
    .filter((file) => /migrations\/00(6[7-9]|[7-9]\d)_|["'`]00(6[7-9]|[7-9]\d)_[a-z0-9_]+\.sql/.test(readFileSync(new URL(file, dir), "utf8").replace(/tests find a product migration[\s\S]*$/m, "")));
  assert.deepEqual(offenders, []);
});
