import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

import {
  envTenantConfig,
  loadStoreIdentity,
  resolveTenantConfig,
  siteNoindex,
  type StoreIdentityRow,
  LOCALE_PATTERN,
  THEME_COLOR_PATTERN,
} from "./tenant.ts";

test("a database row wins over the environment for every identity field", () => {
  const row: StoreIdentityRow = {
    name: "Toko Bunga",
    slug: "toko-bunga",
    site_url: "https://tokobunga.example",
    description: "Karangan bunga segar",
    logo: "/images/toko-bunga.webp",
    tagline: "Bunga Setiap Hari",
    theme_color: "#A31F34",
    locale: "en-US",
    storefront_template: "wide-catalog",
    admin_name: "Toko Bunga Ops",
  };

  const tenant = resolveTenantConfig(row);

  assert.equal(tenant.name, "Toko Bunga");
  assert.equal(tenant.slug, "toko-bunga");
  assert.equal(tenant.siteUrl, "https://tokobunga.example");
  assert.equal(tenant.description, "Karangan bunga segar");
  assert.equal(tenant.logo, "/images/toko-bunga.webp");
  assert.equal(tenant.tagline, "Bunga Setiap Hari");
  assert.equal(tenant.themeColor, "#A31F34");
  assert.equal(tenant.locale, "en-US");
  assert.equal(tenant.openGraphLocale, "en_US");
  assert.equal(tenant.storefrontTemplate, "wide-catalog");
  assert.equal(tenant.adminName, "Toko Bunga Ops");
  assert.equal(tenant.defaultTitle, "Toko Bunga - Bunga Setiap Hari");
});

test("a null or empty column falls back rather than blanking the field", () => {
  // This is what lets an install that predates migration 0036 keep rendering:
  // its columns are all NULL, so every field resolves from the environment.
  const fromNothing = resolveTenantConfig(null);
  assert.equal(fromNothing.name, envTenantConfig.name);
  assert.equal(fromNothing.siteUrl, envTenantConfig.siteUrl);

  // A column present but blank must behave as unset, not as an empty name.
  const blank = resolveTenantConfig({ name: "   ", logo: "" });
  assert.equal(blank.name, envTenantConfig.name);
  assert.equal(blank.logo, envTenantConfig.logo);

  // A partially configured row takes only what it actually declares.
  const partial = resolveTenantConfig({ name: "Setengah Jadi" });
  assert.equal(partial.name, "Setengah Jadi");
  assert.equal(partial.siteUrl, envTenantConfig.siteUrl);
});

test("an invalid stored value degrades instead of taking the storefront down", () => {
  // Every one of these used to be impossible: the values came from a build. Now
  // an operator can type them, so each must fail soft.
  const tenant = resolveTenantConfig({
    site_url: "http://not-https.example/with/path",
    theme_color: "rebeccapurple",
    locale: "not a locale",
    storefront_template: "Not a valid template ID",
  });

  assert.equal(tenant.siteUrl, "https://example.com", "non-https URL rejected");
  assert.equal(tenant.themeColor, "#111111", "invalid colour rejected");
  assert.equal(tenant.locale, "id-ID", "invalid locale rejected");
  assert.equal(
    tenant.storefrontTemplate,
    "compact-market",
    "malformed template ID degrades to the default rather than throwing",
  );
});

test("a runtime template slug survives identity resolution for D1 validation", () => {
  const tenant = resolveTenantConfig({
    storefront_template: "merchant-runtime-template",
  });
  assert.equal(tenant.storefrontTemplate, "merchant-runtime-template");
});

test("an unknown storefront template no longer throws", () => {
  // It used to throw at module load, which in a Worker means every route
  // returns 500 — a single bad database row would have taken the store offline.
  assert.doesNotThrow(() =>
    resolveTenantConfig({ storefront_template: "🙂" }),
  );
});

test("identity reads survive a missing table and a failing database", async () => {
  const throwing = {
    prepare() {
      throw new Error("no such table: stores");
    },
  } as unknown as D1Database;
  assert.equal(await loadStoreIdentity(throwing), null);

  const empty = {
    prepare: () => ({ first: async () => null }),
  } as unknown as D1Database;
  assert.equal(await loadStoreIdentity(empty), null);

  // A null read must still produce a usable identity, because that is exactly
  // the state of a database on its very first request.
  assert.equal(resolveTenantConfig(null).name, envTenantConfig.name);
});

test("the resolved config is frozen so a page cannot mutate shared identity", () => {
  const tenant = resolveTenantConfig({ name: "Toko Beku" });
  assert.throws(() => {
    (tenant as { name: string }).name = "diubah";
  }, TypeError);
});

test("an unconfigured store never advertises itself as unconfigured", () => {
  // Both fields shipped a placeholder sentence as their default, and both
  // surface to customers: the tagline in the <title> (A-70), the description in
  // the <title> and in the meta description Google prints under the result.
  const config = resolveTenantConfig(null);

  assert.equal(config.tagline, "");
  assert.doesNotMatch(config.description, /belum dikonfigurasi/i);
  assert.doesNotMatch(config.defaultTitle, /belum dikonfigurasi/i);
  assert.ok(
    config.description.includes(config.name),
    "the fallback description must describe this store, not a placeholder",
  );

  // A store that has set its own description keeps it verbatim.
  const configured = resolveTenantConfig({
    name: "Toko Bunga",
    description: "Bunga segar diantar hari ini.",
  } as never);
  assert.equal(configured.description, "Bunga segar diantar hari ini.");
});

// `theme_color`, `locale` and `admin_name` resolve from D1 and are rendered
// everywhere — `<meta name="theme-color">`, `<html lang>`, JSON-LD
// `inLanguage`, the admin title — with no operator editor. The editor and the
// resolver must agree on what is valid, or a saved value silently falls back
// and the operator is told nothing about why.

test("the settings editor and identity resolution share one rule for theme colour", () => {
  for (const accepted of ["#111111", "#FFFFFF", "#0a7c3f"]) {
    assert.ok(THEME_COLOR_PATTERN.test(accepted), `${accepted} must be storable`);
    assert.equal(
      resolveTenantConfig({ theme_color: accepted } as never).themeColor,
      accepted,
      `${accepted} must survive resolution unchanged`,
    );
  }
  for (const rejected of ["#fff", "111111", "red", "#1111111", ""]) {
    assert.ok(!THEME_COLOR_PATTERN.test(rejected), `${rejected} must be refused at the form`);
  }
});

test("the settings editor and identity resolution share one rule for locale", () => {
  for (const accepted of ["id-ID", "en-US", "id"]) {
    assert.ok(LOCALE_PATTERN.test(accepted), `${accepted} must be storable`);
    assert.equal(resolveTenantConfig({ locale: accepted } as never).locale, accepted);
  }
  for (const rejected of ["ID-id", "indonesia", "id_ID", "i", ""]) {
    assert.ok(!LOCALE_PATTERN.test(rejected), `${rejected} must be refused at the form`);
  }
});

test("saving the store profile persists all three previously uneditable fields", () => {
  const source = readFileSync(new URL("../pages/api/admin/settings.ts", import.meta.url), "utf8");
  const update = source.slice(source.indexOf('if (body.action === "save-store")'));
  const statement = update.slice(update.indexOf("UPDATE stores"), update.indexOf(".run()"));
  for (const column of ["theme_color", "locale", "admin_name"]) {
    assert.match(statement, new RegExp(`${column} = \\?`), `save-store must write ${column}`);
  }
  // A blank field clears the column back to NULL — "not configured here" —
  // rather than storing an empty string the resolver would treat as a value.
  assert.match(statement, /clean\(body\.admin_name, 120\) \|\| null/);
});

test("the header brand mark is opt-in and accepts only a site or https image path", () => {
  const previous = process.env.PUBLIC_SITE_BRAND_MARK;
  try {
    delete process.env.PUBLIC_SITE_BRAND_MARK;
    assert.equal(resolveTenantConfig(null).brandMark, "");

    for (const accepted of ["/images/mark.svg", "https://cdn.example/mark.svg"]) {
      process.env.PUBLIC_SITE_BRAND_MARK = accepted;
      assert.equal(resolveTenantConfig(null).brandMark, accepted);
    }
    for (const refused of ["//evil.example/mark.svg", "javascript:alert(1)", "http://cdn.example/m.svg", "mark.svg"]) {
      process.env.PUBLIC_SITE_BRAND_MARK = refused;
      assert.equal(resolveTenantConfig(null).brandMark, "", refused);
    }
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_SITE_BRAND_MARK;
    else process.env.PUBLIC_SITE_BRAND_MARK = previous;
  }
});

test("the store-wide noindex is opt-in and only `true` or `1` turns it on", () => {
  const previous = process.env.PUBLIC_SITE_NOINDEX;
  try {
    delete process.env.PUBLIC_SITE_NOINDEX;
    assert.equal(resolveTenantConfig(null).noindex, false);
    for (const on of ["true", "TRUE", "1"]) {
      process.env.PUBLIC_SITE_NOINDEX = on;
      assert.equal(resolveTenantConfig(null).noindex, true, on);
    }
    for (const off of ["false", "0", "yes", "ture"]) {
      process.env.PUBLIC_SITE_NOINDEX = off;
      assert.equal(resolveTenantConfig(null).noindex, false, off);
    }
    // The middleware reads the Worker's runtime vars, not only the build env.
    delete process.env.PUBLIC_SITE_NOINDEX;
    assert.equal(siteNoindex({ PUBLIC_SITE_NOINDEX: "true" }), true);
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_SITE_NOINDEX;
    else process.env.PUBLIC_SITE_NOINDEX = previous;
  }
});

test("a page title names the store once, never twice", async () => {
  const { withStoreName } = await import("./tenant.ts");
  assert.equal(withStoreName("Kebijakan Privasi Petani Sejahtera", "Petani Sejahtera"), "Kebijakan Privasi Petani Sejahtera");
  assert.equal(withStoreName("Kontak Resmi", "Petani Sejahtera"), "Kontak Resmi - Petani Sejahtera");
});

test("saving the store profile no longer writes the support WhatsApp number (PRD A35)", () => {
  const source = readFileSync(new URL("../pages/api/admin/settings.ts", import.meta.url), "utf8");
  const update = source.slice(source.indexOf('if (body.action === "save-store")'));
  const statement = update.slice(update.indexOf("UPDATE stores"), update.indexOf(".run()"));
  // whatsapp-numbers.ts is the only writer; a stale form field must not win.
  assert.doesNotMatch(statement, /support_whatsapp/);
  assert.doesNotMatch(update.slice(0, update.indexOf("UPDATE stores")), /Nomor WhatsApp harus/);
});

test("a store with no logo, or the deleted placeholder wordmark, resolves to no logo", () => {
  assert.equal(resolveTenantConfig({ name: "Toko", logo: "/images/adsbook-mark.webp" }).logo, "");
  assert.equal(resolveTenantConfig({ name: "Toko", logo: null }).logo, "");
  assert.equal(resolveTenantConfig({ name: "Toko", logo: "/images/logo-toko.png" }).logo, "/images/logo-toko.png");
});
