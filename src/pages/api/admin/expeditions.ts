import type { APIRoute } from 'astro';
import { z } from 'zod';
import { jsonError, jsonOk } from '../../../lib/api.ts';
import { getRuntimeEnv } from '../../../lib/env.ts';
import { invalidateStoreConfigCache } from '../../../lib/store-config-cache.ts';
import {
  parseProvinceCodeList,
  validateProvinceCodeList,
} from '../../../lib/province.ts';

export const prerender = false;

type CourierRule = {
  id: number;
  courierCode: string;
  isEnabled: number;
  isCodEnabled: number;
  excludedProvinces: string | null;
};

type OriginWarehouse = {
  id: number;
  name: string;
  originAreaId: string;
  originLabel: string | null;
  address: string;
  city: string;
  province: string;
};
const expeditionMutationSchema = z.union([
  z
    .object({
      courierId: z.number().int().positive(),
      field: z.enum(['enabled', 'cod']),
      value: z.boolean(),
    })
    .strict(),
  z
    .object({
      codDisabledProvinceCodes: z.array(z.string()),
    })
    .strict(),
]);

const getDatabase = (locals: App.Locals) => {
  const database = getRuntimeEnv(locals)?.OMS_DB;
  return database &&
    typeof database === 'object' &&
    typeof (database as D1Database).prepare === 'function'
    ? database as D1Database
    : null;
};

const listCourierRules = (database: D1Database) =>
  database.prepare(`
    SELECT
      id,
      courier_code AS courierCode,
      is_enabled AS isEnabled,
      is_cod_enabled AS isCodEnabled,
      excluded_provinces AS excludedProvinces
    FROM courier_rules
    WHERE store_id = (SELECT id FROM stores ORDER BY id LIMIT 1)
    ORDER BY courier_code
  `).all<CourierRule>();

const getOriginWarehouse = (database: D1Database) =>
  database.prepare(`
    SELECT
      id,
      name,
      origin_area_id AS originAreaId,
      origin_label AS originLabel,
      address,
      city,
      province
    FROM warehouses
    WHERE store_id = (SELECT id FROM stores ORDER BY id LIMIT 1)
    ORDER BY is_primary DESC, id
    LIMIT 1
  `).first<OriginWarehouse>();

export const GET: APIRoute = async ({ locals }) => {
  const database = getDatabase(locals);
  if (!database) return jsonError('Database ekspedisi belum tersedia.', 500);

  try {
    const [courierResult, store, originWarehouse] = await Promise.all([
      listCourierRules(database),
      database
        .prepare(
          'SELECT cod_disabled_province_codes FROM stores ORDER BY id LIMIT 1',
        )
        .first<{ cod_disabled_province_codes: string | null }>(),
      getOriginWarehouse(database),
    ]);

    return jsonOk({
      data: {
        couriers: courierResult.results ?? [],
        codDisabledProvinceCodes: parseProvinceCodeList(
          store?.cod_disabled_province_codes,
        ),
        originWarehouse: originWarehouse ?? undefined,
      },
    });
  } catch (error) {
    console.error('expeditions-list', error);
    return jsonError('Gagal memuat pengaturan ekspedisi.', 500);
  }
};

export const PATCH: APIRoute = async ({ locals, request }) => {
  const database = getDatabase(locals);
  if (!database) return jsonError('Database ekspedisi belum tersedia.', 500);

  const parsed = expeditionMutationSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return jsonError('Pengaturan ekspedisi tidak valid.', 400);
  }

  const body = parsed.data;
  if (!('courierId' in body)) {
    const validation = validateProvinceCodeList(
      body.codDisabledProvinceCodes,
    );
    if (!validation.success) {
      return jsonError('Kode provinsi kebijakan COD tidak valid.', 400);
    }

    try {
      const result = await database
        .prepare(`
          UPDATE stores
          SET cod_disabled_province_codes = ?
          WHERE id = (SELECT id FROM stores ORDER BY id LIMIT 1)
        `)
        .bind(validation.codes.join(','))
        .run();
      if (!result.meta?.changes) {
        return jsonError('Toko belum dikonfigurasi.', 400);
      }
      // The public form-config endpoint caches this policy in KV. Drop it now
      // so the change is live immediately instead of after the cache TTL.
      await invalidateStoreConfigCache(
        getRuntimeEnv(locals)?.SESSION as KVNamespace | undefined,
      );
      return jsonOk({
        message: 'Kebijakan wilayah COD berhasil disimpan.',
        data: { codDisabledProvinceCodes: validation.codes },
      });
    } catch (error) {
      console.error('expeditions-cod-policy-update', error);
      return jsonError('Gagal menyimpan kebijakan wilayah COD.', 500);
    }
  }

  const { courierId, field, value } = body;

  try {
    const column = field === 'enabled' ? 'is_enabled' : 'is_cod_enabled';
    const result = await database
      .prepare(`
        UPDATE courier_rules
        SET ${column} = ?
        WHERE id = ?
          AND store_id = (SELECT id FROM stores ORDER BY id LIMIT 1)
      `)
      .bind(value ? 1 : 0, courierId)
      .run();
    if (!result.meta?.changes) {
      return jsonError('Ekspedisi tidak ditemukan.', 400);
    }
    return jsonOk({
      message: `${
        field === 'enabled' ? 'Status layanan' : 'Status COD'
      } berhasil diperbarui.`,
    });
  } catch (error) {
    console.error('expeditions-update', error);
    return jsonError('Gagal memperbarui pengaturan ekspedisi.', 500);
  }
};
