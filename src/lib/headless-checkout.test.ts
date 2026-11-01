import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTrustedHeadlessShipping } from './headless-checkout.ts';

test('resolveTrustedHeadlessShipping requires server-quoted destination and courier', async () => {
  await assert.rejects(
    () =>
      resolveTrustedHeadlessShipping(
        { shipping_cost: -50000 },
        {
          customer_name: 'Tester',
          customer_phone: '081234567890',
          customer_email: '',
          address: 'Jalan Mawar No. 1, Bandung',
          district: 'Coblong',
          province: 'Jawa Barat',
          postal_code: '40132',
          payment_method: 'cod',
          variant_id: '12',
          quantity: 1,
          submit_token: 'sb_test_token_123456',
        },
        async () => ({ rates: [] }),
      ),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      Reflect.get(error, 'code') === 'SHIPPING_QUOTE_REQUIRED',
  );
});

test('resolveTrustedHeadlessShipping trusts provider quote instead of client shipping_cost', async () => {
  const shipping = await resolveTrustedHeadlessShipping(
    {
      destination_id: 'dst-1',
      courier_code: 'jne',
      courier_service_id: 1,
      shipping_cost: -50000,
      city: 'Bandung',
    },
    {
      customer_name: 'Tester',
      customer_phone: '081234567890',
      customer_email: '',
      address: 'Jalan Mawar No. 1, Bandung',
      district: 'Coblong',
      province: 'Jawa Barat',
      postal_code: '40132',
      payment_method: 'cod',
      variant_id: '12',
      quantity: 1,
      submit_token: 'sb_test_token_123456',
    },
    async () => ({
      rates: [
        {
          courier_code: 'jne',
          courier_service: 'REG',
          price: 18000,
          estimated_days: '2-3',
          unsupported: false,
          unsupported_cod: false,
          cod_fee: 2500,
        },
      ],
      warehouse: {
        id: 9,
      },
    }),
  );

  assert.deepEqual(shipping, {
    destinationId: 'dst-1',
    // The provider's cod_fee is not shipping: persistOrder adds the store's own
    // COD service fee once, the same as storefront checkout (shipping-quote.ts).
    shippingCost: 18000,
    courierCode: 'jne',
    courierService: 'REG',
    warehouseId: 9,
  });
});

test('resolveTrustedHeadlessShipping refuses a primary price when the city chose another warehouse and none was echoed (finding 23)', async () => {
  // Two warehouses: the rate route, given `city`, quotes from warehouse 2 at
  // 30000; without it, from the primary (1) at 18000.
  const quoteResolver = async (input: { destinationProvince?: string; warehouseId?: number }) => {
    const fromSecond = input.warehouseId === 2 || Boolean(input.destinationProvince);
    return {
      rates: [
        {
          courier_code: 'jne',
          courier_service: 'REG',
          price: fromSecond ? 30000 : 18000,
          estimated_days: '2-3',
          unsupported: false,
          unsupported_cod: false,
          cod_fee: 0,
        },
      ],
      warehouse: { id: fromSecond ? 2 : 1 },
    };
  };
  const data = {
    customer_name: 'Tester',
    customer_phone: '081234567890',
    customer_email: '',
    address: 'Jalan Mawar No. 1, Bandung',
    district: 'Coblong',
    province: 'Jawa Barat',
    postal_code: '40132',
    payment_method: 'cod',
    variant_id: '12',
    quantity: 1,
    submit_token: 'sb_test_token_123456',
  } as const;
  const body = { destination_id: 'dst-1', courier_code: 'jne', courier_service_id: 1, city: 'Bandung' };

  // Checkout without `warehouse_id` is never silently charged the primary's 18000.
  await assert.rejects(
    () => resolveTrustedHeadlessShipping(body, data, quoteResolver),
    (error: unknown) => error instanceof Error && Reflect.get(error, 'code') === 'SHIPPING_QUOTE_CHANGED',
  );
  // Echoing the rate call's `warehouse_id` charges what that call showed.
  const echoed = await resolveTrustedHeadlessShipping({ ...body, warehouse_id: 2 }, data, quoteResolver);
  assert.equal(echoed.shippingCost, 30000);
  assert.equal(echoed.warehouseId, 2);
  // No city: the rate call could only have shown the primary, which is charged.
  const { city: _city, ...withoutCity } = body;
  const primary = await resolveTrustedHeadlessShipping(withoutCity, data, quoteResolver);
  assert.equal(primary.shippingCost, 18000);
  assert.equal(primary.warehouseId, 1);
});
