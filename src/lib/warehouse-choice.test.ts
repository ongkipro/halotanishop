import assert from "node:assert/strict";
import test from "node:test";
import { indonesiaDistricts } from "../data/indonesia-districts.ts";
import { INDONESIAN_PROVINCES, normalizeProvinceCode } from "./province.ts";
import {
  ambiguousCityNames,
  chooseWarehouse,
  ISLAND_GROUPS,
  islandGroupOf,
  provinceCodeForCity,
  servedProvinceCodes,
  type WarehouseCandidate,
} from "./warehouse-choice.ts";

const warehouse = (overrides: Partial<WarehouseCandidate> & { id: number }): WarehouseCandidate => ({
  is_primary: 0,
  is_active: 1,
  origin_area_id: `area-${overrides.id}`,
  pickup_address_id: `pickup-${overrides.id}`,
  province: "Jawa Barat",
  served_provinces: null,
  ...overrides,
});

const bandung = warehouse({ id: 1, is_primary: 1, province: "Jawa Barat" });
const surabaya = warehouse({ id: 2, province: "JAWA TIMUR" });
const medan = warehouse({ id: 3, province: "Sumatera Utara", served_provinces: '["SU","AC"]' });

test("one warehouse is always the choice, ready or not (REQ-242)", () => {
  const only = warehouse({ id: 9, is_primary: 1, pickup_address_id: "" });
  for (const province of ["", "JI", "PA", "XX"]) {
    assert.equal(chooseWarehouse([only], province)?.warehouse, only);
  }
  assert.equal(chooseWarehouse([], "JI"), undefined);
});

test("coverage first: the warehouse serving the buyer's province", () => {
  assert.deepEqual(chooseWarehouse([bandung, surabaya, medan], "JI"), { warehouse: surabaya, reason: "coverage" });
  // An added province counts like the own one.
  assert.deepEqual(chooseWarehouse([bandung, surabaya, medan], "AC"), { warehouse: medan, reason: "coverage" });
  // Accepts a province name as well as a code.
  assert.equal(chooseWarehouse([bandung, surabaya], "Jawa Timur")?.warehouse, surabaya);
});

test("island group next: a Jawa buyer outside every list ships from Jawa, not Sumatera", () => {
  const sumateraPrimary = warehouse({ id: 1, is_primary: 1, province: "Sumatera Utara" });
  const surabayaOnly = warehouse({ id: 2, province: "Jawa Timur" });
  assert.deepEqual(chooseWarehouse([sumateraPrimary, surabayaOnly], "JT"), { warehouse: surabayaOnly, reason: "island" });
});

test("primary last: no coverage and no island match", () => {
  assert.deepEqual(chooseWarehouse([bandung, surabaya, medan], "PA"), { warehouse: bandung, reason: "primary" });
});

test("an unknown or empty province is quoted from the primary", () => {
  assert.deepEqual(chooseWarehouse([surabaya, bandung], ""), { warehouse: bandung, reason: "primary" });
  assert.deepEqual(chooseWarehouse([surabaya, bandung], "Atlantis"), { warehouse: bandung, reason: "primary" });
});

test("ties go to the primary, then the lowest id", () => {
  const second = warehouse({ id: 5, province: "Jawa Timur" });
  const third = warehouse({ id: 4, province: "Jawa Timur" });
  const primaryInJatim = warehouse({ id: 8, is_primary: 1, province: "Jawa Timur" });
  assert.equal(chooseWarehouse([second, third, primaryInJatim], "JI")?.warehouse, primaryInJatim);
  assert.equal(chooseWarehouse([second, third, bandung], "JI")?.warehouse, third);
  // With no row flagged (a store mid-upgrade), the lowest id stands in.
  assert.equal(chooseWarehouse([second, third], "PA")?.warehouse, third);
});

test("a not-ready or inactive warehouse is never chosen by coverage or island", () => {
  const noPickup = warehouse({ id: 2, province: "Jawa Timur", pickup_address_id: "" });
  const noOrigin = warehouse({ id: 3, province: "Jawa Timur", origin_area_id: " " });
  const inactive = warehouse({ id: 4, province: "Jawa Timur", is_active: 0 });
  assert.deepEqual(chooseWarehouse([bandung, noPickup, noOrigin, inactive], "JI"), {
    warehouse: bandung,
    reason: "island",
  });
  const sumateraPrimary = warehouse({ id: 1, is_primary: 1, province: "Sumatera Utara" });
  assert.deepEqual(chooseWarehouse([sumateraPrimary, noPickup, inactive], "JI"), {
    warehouse: sumateraPrimary,
    reason: "primary",
  });
});

test("served provinces default to the own one; a malformed list falls back to it", () => {
  assert.deepEqual(servedProvinceCodes({ province: "DKI Jakarta", served_provinces: null }), ["JK"]);
  assert.deepEqual(servedProvinceCodes({ province: "Jawa Barat", served_provinces: '["JB","JK","jk","BT"]' }), ["JB", "JK", "BT"]);
  assert.deepEqual(servedProvinceCodes({ province: "Jawa Barat", served_provinces: "not json" }), ["JB"]);
  assert.deepEqual(servedProvinceCodes({ province: "Jawa Barat", served_provinces: "[]" }), ["JB"]);
});

test("every one of the 38 province codes sits in exactly one island group", () => {
  const all = Object.values(ISLAND_GROUPS).flat();
  assert.equal(all.length, 38);
  assert.equal(new Set(all).size, 38);
  assert.deepEqual([...all].sort(), INDONESIAN_PROVINCES.map((province) => province.code).sort());
  for (const { code } of INDONESIAN_PROVINCES) assert.ok(islandGroupOf(code), code);
});

test("A-404: every city in the district index resolves to one province, except the listed ambiguous names", () => {
  // Kota Banjar (Jawa Barat) and Kabupaten Banjar (Kalimantan Selatan): the
  // index carries no Kota/Kabupaten prefix, so the name alone cannot tell.
  // Such a buyer is quoted from the primary, identically on rate and submit.
  assert.deepEqual(ambiguousCityNames(), ["banjar"]);
  const unresolved = new Set<string>();
  for (const [, city, province] of indonesiaDistricts) {
    const code = provinceCodeForCity(city);
    if (!code) {
      unresolved.add(city);
      continue;
    }
    assert.equal(code, normalizeProvinceCode(province), `${city} → ${province}`);
  }
  assert.deepEqual([...unresolved], ["Banjar"]);
});

test("A-404: Mengantar's city spellings resolve too", () => {
  assert.equal(provinceCodeForCity("Kota Surabaya"), "JI");
  assert.equal(provinceCodeForCity("KABUPATEN SIDOARJO"), "JI");
  assert.equal(provinceCodeForCity("Kab. Bandung Barat"), "JB");
  assert.equal(provinceCodeForCity("Kota Adm. Jakarta Selatan"), "JK");
  assert.equal(provinceCodeForCity("JAKARTA TIMUR"), "JK");
  assert.equal(provinceCodeForCity("Kota Banda Aceh"), "AC");
  assert.equal(provinceCodeForCity("Mamuju Utara"), "SR");
  assert.equal(provinceCodeForCity("Kota Banjar"), "");
  assert.equal(provinceCodeForCity(""), "");
  assert.equal(provinceCodeForCity(undefined), "");
  assert.equal(provinceCodeForCity("Gotham"), "");
});
