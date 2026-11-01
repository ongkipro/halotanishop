/**
 * Variant weight as the operator reads it: whole grams, with kg beside it
 * (PRD A41). Storage and input stay in grams; kg is only ever a hint.
 */
const KG_FORMAT = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
const GRAM_FORMAT = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

/** 1250 → "1,25 kg". */
export function formatKg(grams: number): string {
  return `${KG_FORMAT.format(grams / 1000)} kg`;
}

/** 2500 → "2.500 g". */
export function formatGrams(grams: number): string {
  return `${GRAM_FORMAT.format(grams)} g`;
}

/** 2500 → "2.500 g (2,5 kg)". */
export function formatWeight(grams: number): string {
  return `${formatGrams(grams)} (${formatKg(grams)})`;
}

export type WeighedItem = {
  quantity: number;
  /** Recorded on the order, else the variant's current weight; null when neither exists. */
  weight_grams?: number | null;
  /** True when the weight was recorded on the order at checkout (A-397). */
  weight_recorded?: boolean | number | null;
};

export type ItemWeight = {
  unit: number | null;
  line: number | null;
  recorded: boolean;
};

export type OrderWeightSummary = {
  items: ItemWeight[];
  /** Null when any line's weight is unknown: a partial sum would read as the parcel. */
  total: number | null;
  /** True only when every line carries the weight recorded at checkout. */
  recorded: boolean;
};

export const RECORDED_WEIGHT_LABEL = "berat saat order";
export const CURRENT_WEIGHT_LABEL = "berat varian saat ini";

function knownWeight(value: unknown): number | null {
  const grams = Number(value);
  return value !== null && value !== undefined && Number.isFinite(grams) && grams > 0
    ? grams
    : null;
}

/**
 * One unit's weight in kg as a shipping quote and Mengantar dispatch send it:
 * grams / 1000, never below 1 g (`mengantar-dispatch.ts` reads
 * `MAX(0.001, grams / 1000)`). Null when the weight is unknown. OrderDetail's
 * re-quote preview sends this so it quotes what the save and dispatch use (A-397).
 */
export function quoteUnitWeightKg(grams: unknown): number | null {
  const known = knownWeight(grams);
  return known === null ? null : Math.max(0.001, known / 1000);
}

export function summarizeOrderWeight(items: readonly WeighedItem[]): OrderWeightSummary {
  const lines = items.map((item): ItemWeight => {
    const unit = knownWeight(item.weight_grams);
    const quantity = Number(item.quantity) || 0;
    return {
      unit,
      line: unit === null ? null : unit * quantity,
      recorded: unit !== null && Boolean(item.weight_recorded),
    };
  });
  const total = lines.some((line) => line.line === null)
    ? null
    : lines.reduce((sum, line) => sum + (line.line ?? 0), 0);
  return {
    items: lines,
    total: lines.length ? total : null,
    recorded: lines.length > 0 && lines.every((line) => line.recorded),
  };
}
