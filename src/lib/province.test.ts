import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { indonesiaDistricts } from "../data/indonesia-districts.ts";
import {
  DEFAULT_COD_DISABLED_PROVINCE_CODES,
  INDONESIAN_PROVINCES,
  buyerAreaLines,
  getProvinceName,
  isProvinceExcluded,
  normalizeProvince,
  normalizeProvinceCode,
  normalizeProvinceName,
  parseProvinceCodeList,
  validateProvinceCodeList,
} from "./province.ts";

/**
 * This module decides where COD is offered, and it had no test.
 *
 * `isProvinceExcluded` resolves a province to a code and returns `false` when
 * it cannot — so a province this file does not know is a province where COD is
 * **allowed**, whatever the store disabled. That is only safe while every
 * province a buyer can actually reach checkout with resolves.
 *
 * The province list is not stable ground: Papua was split into six between
 * 2022 and 2024, and `indonesia-districts.ts` is external data (cahyadsn/wilayah,
 * Kepmendagri No. 300.2.2-2138/2025) that will be refreshed again. A refresh
 * that adds or renames a province while this list stays put silently opens COD
 * in a province the operator disabled, and nothing else would report it.
 */
test("every province the district catalog can produce resolves to a code", () => {
  const provinces = [...new Set(indonesiaDistricts.map(([, , province]) => String(province)))];
  assert.ok(provinces.length >= 38, `catalog carries ${provinces.length} provinces`);

  const unresolved = provinces.filter((province) => !normalizeProvinceCode(province));
  assert.deepEqual(
    unresolved,
    [],
    "a catalog province with no code is a province where COD can never be blocked:\n  " +
      unresolved.join("\n  "),
  );

  // And the reverse: a province in this list that the catalog cannot produce is
  // dead weight an operator can still select in settings.
  const catalogCodes = new Set(provinces.map((province) => normalizeProvinceCode(province)));
  const orphaned = INDONESIAN_PROVINCES.filter((province) => !catalogCodes.has(province.code));
  assert.deepEqual(orphaned.map((p) => p.code), []);
});

/**
 * A fresh install takes its COD exclusions from migration `0017`'s column
 * default; every other path takes them from the constant. They must agree, or
 * a new store silently disables COD somewhere the code says it does not.
 */
test("the COD exclusion default matches the column default a fresh install gets", () => {
  const migration = readFileSync(
    new URL("../db/migrations/0017_freezing_greymalkin.sql", import.meta.url),
    "utf8",
  );
  const seeded = migration.match(/cod_disabled_province_codes` text DEFAULT '([^']*)'/)?.[1];
  assert.ok(seeded, "migration 0017 must still seed the column default");
  assert.equal(seeded, DEFAULT_COD_DISABLED_PROVINCE_CODES.join(","));
  // Every seeded code must be a province this module knows, or the store starts
  // with an exclusion that can never match a buyer.
  for (const code of seeded.split(",")) {
    assert.ok(getProvinceName(code), `seeded code ${code} resolves to no province`);
  }
});

test("a province arrives in many shapes and resolves to one code", () => {
  // ISO-3166-2 form, as Cloudflare's `cf.regionCode` can present it.
  assert.equal(normalizeProvinceCode("ID-JK"), "JK");
  assert.equal(normalizeProvinceCode("jk"), "JK");
  // The names buyers and providers actually write.
  for (const written of ["DKI Jakarta", "dki jakarta", "Jakarta", "Provinsi DKI Jakarta", "D.K.I. Jakarta"]) {
    assert.equal(normalizeProvinceCode(written), "JK", written);
  }
  for (const written of ["DI Yogyakarta", "Yogyakarta", "Jogja", "jogjakarta", "Daerah Istimewa Yogyakarta"]) {
    assert.equal(normalizeProvinceCode(written), "YO", written);
  }
  assert.equal(normalizeProvinceCode("Kep. Riau"), "KR");
  assert.equal(normalizeProvinceCode("NTT"), "NT");
  assert.equal(normalizeProvinceCode("malut"), "MU");

  assert.equal(getProvinceName("PT"), "Papua Tengah");
  assert.equal(normalizeProvinceName("ID-BA"), "bali");
  assert.equal(normalizeProvince("  PROVINSI   Jawa-Barat "), "jawa barat");

  // Nothing recognisable resolves to nothing, rather than to a neighbour.
  for (const junk of ["", "   ", "Selangor", "XX", null, undefined, 42]) {
    assert.equal(normalizeProvinceCode(junk), "", String(junk));
  }
});

/**
 * The fail-open is deliberate and asserted here so it stays a decision rather
 * than becoming an accident: an unresolvable province must not block a sale,
 * which is only defensible because the test above proves every reachable
 * province resolves.
 */
test("COD exclusion matches on code, and an unknown province does not block a sale", () => {
  const disabled = DEFAULT_COD_DISABLED_PROVINCE_CODES;
  assert.equal(isProvinceExcluded("Papua Tengah", disabled), true);
  assert.equal(isProvinceExcluded("ID-PT", disabled), true);
  assert.equal(isProvinceExcluded("papua tengah", disabled), true);
  assert.equal(isProvinceExcluded("Jawa Barat", disabled), false);
  // The excluded list may itself be written as names rather than codes.
  assert.equal(isProvinceExcluded("JK", ["DKI Jakarta"]), true);
  assert.equal(isProvinceExcluded("Selangor", disabled), false);
  assert.equal(isProvinceExcluded("", disabled), false);
});

test("an operator's exclusion list is validated before it is stored", () => {
  assert.deepEqual(validateProvinceCodeList(["JK", "id-ba", "PT"]), {
    success: true,
    codes: ["JK", "BA", "PT"],
  });
  // Duplicates collapse rather than being stored twice.
  assert.deepEqual(parseProvinceCodeList("JK, ID-JK ,jk"), ["JK"]);
  assert.deepEqual(parseProvinceCodeList(""), []);

  assert.deepEqual(validateProvinceCodeList("JK,BA"), {
    success: false,
    invalidCodes: ["FORMAT"],
  });
  assert.deepEqual(validateProvinceCodeList(["JK", "ZZ"]), {
    success: false,
    invalidCodes: ["ZZ"],
  });
  assert.deepEqual(validateProvinceCodeList(["Jawa Barat"]), {
    success: false,
    invalidCodes: ["Jawa Barat"],
  });
});

test("buyerAreaLines: short district/city line, catalogue province, full text kept", () => {
  assert.deepEqual(buyerAreaLines("Tebet", "Administrasi Jakarta Selatan", "Daerah Khusus Ibukota Jakarta"), {
    local: "Tebet, Jakarta Selatan",
    region: "DKI Jakarta",
    full: "Tebet, Administrasi Jakarta Selatan, Daerah Khusus Ibukota Jakarta",
  });
  assert.equal(buyerAreaLines("Depok", "Sleman", "Daerah Istimewa Yogyakarta").region, "DI Yogyakarta");
  assert.equal(buyerAreaLines("", "", "ID-JK").region, "DKI Jakarta");
  // A district named like its city is shown once.
  assert.equal(buyerAreaLines("Bandung", "bandung", "Jawa Barat").local, "Bandung");
  // An unknown province spelling stays as typed rather than being guessed.
  assert.equal(buyerAreaLines("X", "Y", "Provinsi Antah").region, "Provinsi Antah");
  assert.deepEqual(buyerAreaLines(null, undefined, ""), { local: "", region: "", full: "" });
});
