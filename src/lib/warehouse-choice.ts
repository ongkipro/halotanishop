/**
 * Which warehouse a quote ships from (PRD A42, REQ-239, ADR on the choice rule).
 *
 * Province coverage, then the same island group, then the primary. No
 * coordinates exist in the bundled data and no extra Mengantar call is made:
 * the chooser is a pure function over rows the quote already read.
 */
import { indonesiaDistricts } from "../data/indonesia-districts.ts";
import { normalizeAdministrativeCity } from "./location-search.ts";
import { normalizeProvinceCode } from "./province.ts";

export const ISLAND_GROUPS: Readonly<Record<string, readonly string[]>> = {
  sumatera: ["AC", "SU", "SB", "RI", "JA", "SS", "BE", "LA", "BB", "KR"],
  jawa: ["JK", "JB", "JT", "YO", "JI", "BT"],
  "bali-nusa-tenggara": ["BA", "NB", "NT"],
  kalimantan: ["KB", "KT", "KS", "KI", "KU"],
  sulawesi: ["SA", "ST", "SN", "SG", "GO", "SR"],
  maluku: ["MA", "MU"],
  papua: ["PA", "PB", "PD", "PE", "PS", "PT"],
};

const islandByProvince = new Map(
  Object.entries(ISLAND_GROUPS).flatMap(([group, codes]) =>
    codes.map((code) => [code, group] as const),
  ),
);

export function islandGroupOf(provinceCode: string): string {
  return islandByProvince.get(provinceCode) || "";
}

export type WarehouseCandidate = {
  id: number;
  is_primary: number | boolean | null;
  is_active: number | boolean | null;
  origin_area_id: string | null;
  pickup_address_id: string | null;
  province: string | null;
  served_provinces: string | null;
};

export type WarehouseChoiceReason = "coverage" | "island" | "primary";

/** Ready = Mengantar origin and pickup address both set (REQ-238). */
export function isWarehouseReady(warehouse: Pick<WarehouseCandidate, "origin_area_id" | "pickup_address_id">) {
  return Boolean(
    String(warehouse.origin_area_id ?? "").trim() &&
      String(warehouse.pickup_address_id ?? "").trim(),
  );
}

/** The province codes a warehouse serves: its stored list, else its own province. */
export function servedProvinceCodes(warehouse: Pick<WarehouseCandidate, "province" | "served_provinces">): string[] {
  if (warehouse.served_provinces) {
    try {
      const parsed = JSON.parse(warehouse.served_provinces);
      if (Array.isArray(parsed)) {
        const codes = [...new Set(parsed.map((code) => normalizeProvinceCode(code)).filter(Boolean))];
        if (codes.length) return codes;
      }
    } catch {
      // A malformed list falls back to the warehouse's own province.
    }
  }
  const own = normalizeProvinceCode(warehouse.province);
  return own ? [own] : [];
}

const flag = (value: number | boolean | null | undefined) => value === true || Number(value) === 1;

/**
 * (1) a ready, active warehouse serving the buyer's province; (2) else one in
 * the buyer's island group (by its own province); (3) else the primary. Ties
 * go to the primary, then the lowest id. The primary of rule 3 is returned
 * whatever its readiness, because that is what a one-warehouse store quoted
 * from before A42 (REQ-242). `undefined` only for an empty list.
 */
export function chooseWarehouse<T extends WarehouseCandidate>(
  warehouses: readonly T[],
  buyerProvinceCode: string,
): { warehouse: T; reason: WarehouseChoiceReason } | undefined {
  if (warehouses.length === 0) return undefined;
  const byPreference = [...warehouses].sort(
    (left, right) =>
      Number(flag(right.is_primary)) - Number(flag(left.is_primary)) || left.id - right.id,
  );
  const primary = byPreference[0];
  const buyer = normalizeProvinceCode(buyerProvinceCode);
  if (buyer) {
    const ready = byPreference.filter(
      (warehouse) => flag(warehouse.is_active ?? 1) && isWarehouseReady(warehouse),
    );
    const covering = ready.find((warehouse) => servedProvinceCodes(warehouse).includes(buyer));
    if (covering) return { warehouse: covering, reason: "coverage" };
    const island = islandGroupOf(buyer);
    const sameIsland = island
      ? ready.find((warehouse) => islandGroupOf(normalizeProvinceCode(warehouse.province)) === island)
      : undefined;
    if (sameIsland) return { warehouse: sameIsland, reason: "island" };
  }
  return { warehouse: primary, reason: "primary" };
}

let cityProvinceIndex: Map<string, Set<string>> | undefined;

function cityIndex() {
  if (cityProvinceIndex) return cityProvinceIndex;
  cityProvinceIndex = new Map();
  for (const [, city, province] of indonesiaDistricts) {
    const key = normalizeAdministrativeCity(city);
    const code = normalizeProvinceCode(province);
    if (!key || !code) continue;
    const codes = cityProvinceIndex.get(key) ?? new Set<string>();
    codes.add(code);
    cityProvinceIndex.set(key, codes);
  }
  return cityProvinceIndex;
}

/**
 * The buyer's province code from the city the rate route and every submit
 * route already receive (Mengantar's `CITY_NAME`, "Kota"/"Kabupaten" prefixed
 * or not), via the bundled district index. `""` when the city is unknown or
 * names cities in two provinces (`ambiguousCityNames`): the quote then uses
 * the primary, and does so identically on the rate call and on submit.
 */
export function provinceCodeForCity(city: string | undefined | null): string {
  const key = normalizeAdministrativeCity(String(city ?? ""));
  if (!key) return "";
  const codes = cityIndex().get(key);
  return codes && codes.size === 1 ? [...codes][0] : "";
}

/** Normalised city names in the index that belong to more than one province. */
export function ambiguousCityNames(): string[] {
  return [...cityIndex()]
    .filter(([, codes]) => codes.size > 1)
    .map(([city]) => city)
    .sort();
}
