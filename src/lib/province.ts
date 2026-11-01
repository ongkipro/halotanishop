export type IndonesianProvince = {
  code: string;
  name: string;
};

export const INDONESIAN_PROVINCES: readonly IndonesianProvince[] = [
  { code: 'AC', name: 'Aceh' },
  { code: 'SU', name: 'Sumatera Utara' },
  { code: 'SB', name: 'Sumatera Barat' },
  { code: 'RI', name: 'Riau' },
  { code: 'JA', name: 'Jambi' },
  { code: 'SS', name: 'Sumatera Selatan' },
  { code: 'BE', name: 'Bengkulu' },
  { code: 'LA', name: 'Lampung' },
  { code: 'BB', name: 'Kepulauan Bangka Belitung' },
  { code: 'KR', name: 'Kepulauan Riau' },
  { code: 'JK', name: 'DKI Jakarta' },
  { code: 'JB', name: 'Jawa Barat' },
  { code: 'JT', name: 'Jawa Tengah' },
  { code: 'YO', name: 'DI Yogyakarta' },
  { code: 'JI', name: 'Jawa Timur' },
  { code: 'BT', name: 'Banten' },
  { code: 'BA', name: 'Bali' },
  { code: 'NB', name: 'Nusa Tenggara Barat' },
  { code: 'NT', name: 'Nusa Tenggara Timur' },
  { code: 'KB', name: 'Kalimantan Barat' },
  { code: 'KT', name: 'Kalimantan Tengah' },
  { code: 'KS', name: 'Kalimantan Selatan' },
  { code: 'KI', name: 'Kalimantan Timur' },
  { code: 'KU', name: 'Kalimantan Utara' },
  { code: 'SA', name: 'Sulawesi Utara' },
  { code: 'ST', name: 'Sulawesi Tengah' },
  { code: 'SN', name: 'Sulawesi Selatan' },
  { code: 'SG', name: 'Sulawesi Tenggara' },
  { code: 'GO', name: 'Gorontalo' },
  { code: 'SR', name: 'Sulawesi Barat' },
  { code: 'MA', name: 'Maluku' },
  { code: 'MU', name: 'Maluku Utara' },
  { code: 'PA', name: 'Papua' },
  { code: 'PB', name: 'Papua Barat' },
  { code: 'PD', name: 'Papua Barat Daya' },
  { code: 'PE', name: 'Papua Pegunungan' },
  { code: 'PS', name: 'Papua Selatan' },
  { code: 'PT', name: 'Papua Tengah' },
] as const;

export const DEFAULT_COD_DISABLED_PROVINCE_CODES = [
  'PA',
  'PB',
  'PD',
  'PT',
  'PE',
  'PS',
  'MA',
  'MU',
  'NT',
  'KU',
  'SR',
  'GO',
  'KR',
  'AC',
  'BE',
] as const;

function cleanProvinceText(input: unknown) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/\bprovinsi\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const provinceByCode: Record<string, IndonesianProvince> = Object.fromEntries(
  INDONESIAN_PROVINCES.map((province) => [province.code, province]),
);

const RAW_PROVINCE_ALIAS_MAP: Record<string, string> = {
  'd.i. yogyakarta': 'di yogyakarta',
  'diy yogyakarta': 'di yogyakarta',
  'di yogyakarta': 'di yogyakarta',
  'd i yogyakarta': 'di yogyakarta',
  yogyakarta: 'di yogyakarta',
  'daerah istimewa yogyakarta': 'di yogyakarta',
  jogja: 'di yogyakarta',
  jogjakarta: 'di yogyakarta',
  'd.k.i. jakarta': 'dki jakarta',
  'dki jakarta': 'dki jakarta',
  jakarta: 'dki jakarta',
  'daerah khusus ibukota jakarta': 'dki jakarta',
  'kep. riau': 'kepulauan riau',
  'kep riau': 'kepulauan riau',
  kepri: 'kepulauan riau',
  'kep. bangka belitung': 'kepulauan bangka belitung',
  'kep bangka belitung': 'kepulauan bangka belitung',
  'bangka belitung': 'kepulauan bangka belitung',
  ntb: 'nusa tenggara barat',
  ntt: 'nusa tenggara timur',
  kaltara: 'kalimantan utara',
  sulbar: 'sulawesi barat',
  malut: 'maluku utara',
  ...Object.fromEntries(
    INDONESIAN_PROVINCES.map((province) => [
      province.name.toLowerCase(),
      province.name.toLowerCase(),
    ]),
  ),
};

export const PROVINCE_ALIAS_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(RAW_PROVINCE_ALIAS_MAP).map(([key, value]) => [
    cleanProvinceText(key),
    value,
  ]),
);

const codeByProvinceName: Record<string, string> = Object.fromEntries(
  INDONESIAN_PROVINCES.map((province) => [
    cleanProvinceText(province.name),
    province.code,
  ]),
);

export function normalizeProvince(input: unknown) {
  const value = cleanProvinceText(input);
  if (!value) return '';
  return PROVINCE_ALIAS_MAP[value] || value;
}

export function normalizeProvinceName(input: unknown) {
  const code = normalizeProvinceCode(input);
  return code ? provinceByCode[code]?.name.toLowerCase() || '' : '';
}

export function normalizeProvinceCode(input: unknown) {
  const raw = String(input || '').trim().toUpperCase();
  const suffix = raw.startsWith('ID-') ? raw.slice(3) : raw;
  if (provinceByCode[suffix]) return suffix;

  const provinceName = normalizeProvince(input);
  return codeByProvinceName[provinceName] || '';
}

export function getProvinceName(code: unknown) {
  return provinceByCode[normalizeProvinceCode(code)]?.name || '';
}

export function parseProvinceList(input: unknown) {
  return String(input || '')
    .split(',')
    .map((item) => normalizeProvinceName(item))
    .filter(Boolean);
}

export function parseProvinceCodeList(input: unknown): string[] {
  const values = Array.isArray(input) ? input : String(input || '').split(',');
  return [
    ...new Set(
      values
        .map((item) => normalizeProvinceCode(item))
        .filter(Boolean),
    ),
  ];
}

export function validateProvinceCodeList(input: unknown):
  | { success: true; codes: string[] }
  | { success: false; invalidCodes: string[] } {
  if (!Array.isArray(input)) {
    return { success: false, invalidCodes: ['FORMAT'] };
  }

  const invalidCodes = input.flatMap((item) => {
    if (typeof item !== 'string') return [String(item)];
    const raw = item.trim().toUpperCase();
    const suffix = raw.startsWith('ID-') ? raw.slice(3) : raw;
    if (!/^[A-Z]{2}$/.test(suffix) || !provinceByCode[suffix]) {
      return [String(item)];
    }
    return [];
  });
  if (invalidCodes.length) return { success: false, invalidCodes };
  return { success: true, codes: parseProvinceCodeList(input) };
}

export function isProvinceExcluded(input: unknown, excluded: readonly string[]) {
  const provinceCode = normalizeProvinceCode(input);
  if (!provinceCode) return false;
  return excluded.some((item) => normalizeProvinceCode(item) === provinceCode);
}

/**
 * A buyer's area in two short lines for a list: "district, city" and the
 * province. The province reads by its catalogue name, so `ID-JK` and
 * `Daerah Khusus Ibukota Jakarta` both show `DKI Jakarta`; a spelling the
 * catalogue does not know stays as typed. Jakarta's cities drop the
 * `Administrasi` prefix, and a district that repeats its city is shown once.
 * `full` is the stored text, for a tooltip.
 */
export function buyerAreaLines(district: unknown, city: unknown, province: unknown) {
  const text = (value: unknown) => String(value ?? '').trim();
  const shortCity = text(city).replace(/^(?:kota\s+)?administrasi\s+/i, '');
  const local = [text(district), shortCity]
    .filter(Boolean)
    .filter((part, index, parts) => parts.findIndex((other) => other.toLowerCase() === part.toLowerCase()) === index)
    .join(', ');
  const region = getProvinceName(province) || text(province);
  const full = [text(district), text(city), text(province)].filter(Boolean).join(', ');
  return { local, region, full };
}
