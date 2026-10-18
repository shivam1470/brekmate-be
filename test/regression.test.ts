import { place } from "./fixtures.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Service } from "../src/service.js";
import { MemoryStore, atomic, key } from "../src/store.js";
import { fixtureConfig, customer, manager, seed } from "./fixtures.js";
import { quote } from "../src/pricing.js";
import { runtimeConfig } from "../src/config.js";
const body = {
  lines: [{ sku: "meal", quantity: 1, addons: [] }],
  fulfilment: "pickup",
  useRewards: false,
  payment: "COD",
};
const setup = async () => {
  const service = new Service(new MemoryStore(), { ...fixtureConfig });
  await seed(service);
  return service;
};
for (const n of [0, 1, 4, 5, 9900, 9901, 9999, 10000, 10001])
  test(`reward rounding and subtotal threshold ${n}`, () => {
    const r = quote({
      subtotalPaise: n,
      availableRewardPaise: 50000,
      fulfilment: "delivery",
      useRewards: true,
    });
    assert.equal(r.rewardUsedPaise, Math.floor(n / 5));
    assert.equal(r.deliveryFeePaise, n > 9900 ? 0 : 2000);
    assert.equal(r.totalPaise, n + r.deliveryFeePaise - r.rewardUsedPaise);
  });
test("real public quote rejects customer price and balance injection", async () => {
  const s = await setup();
  await assert.rejects(
    s.basket(customer, { ...body, availableRewardPaise: 999999 }),
  );
  await assert.rejects(
    s.basket(customer, {
      ...body,
      lines: [{ sku: "meal", quantity: 1, addons: [], unitPricePaise: 1 }],
    }),
  );
});
test("duplicated SKU and addon selections rejected", async () => {
  const s = await setup();
  await assert.rejects(
    s.basket(customer, { ...body, lines: [body.lines[0], body.lines[0]] }),
    /duplicate_product/,
  );
  await assert.rejects(
    s.basket(customer, {
      ...body,
      lines: [{ sku: "meal", quantity: 1, addons: ["cheese", "cheese"] }],
    }),
    /duplicate_addon/,
  );
});
test("reorder re-prices against current menu", async () => {
  const s = await setup();
  const o = await place(s, customer, body, "reorder-source");
  await s.saveProduct(manager, {
    expectedVersion: (await s.menu())[0]!.revision,
    sku: "meal",
    name: "Meal",
    category: "Meals",
    pricePaise: 15000,
    stock: 1,
    available: true,
    vegetarian: true,
    addons: {},
  });
  assert.equal((await s.reorder(customer, o.id)).pricing.totalPaise, 15000);
});
test("deleting address removes its PII and hides it from address list", async () => {
  const s = await setup();
  await s.saveAddress(customer, "home", {
    line: "Private street",
    latitude: 28.45,
    longitude: 77.02,
  });
  await s.deleteAddress(customer, "home", "delete-address-key");
  assert.deepEqual((await s.addresses(customer)).items, []);
  const row = await s.store.get(
    key("core", `CUSTOMER#${customer.id}`, "ADDRESS#home"),
  );
  assert.equal(row?.line, undefined);
});
test("order status notification is written with state transition", async () => {
  const s = await setup();
  const o = await place(s, customer, body, "notification-order");
  await s.transition(
    manager,
    o.id,
    { status: "accepted" },
    "notification-accept",
  );
  const feed = await s.notifications(customer);
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0]?.status, "accepted");
});
test("menu query pagination preserves all products", async () => {
  const s = await setup();
  for (let i = 0; i < 55; i++)
    await s.saveProduct(manager, {
      sku: `sku-${i}`,
      name: `Meal ${i}`,
      category: "Meals",
      pricePaise: 100,
      stock: 1,
      available: true,
      vegetarian: true,
      addons: {},
    });
  const a = await s.menuPage();
  assert.equal(a.items.length, 50);
  assert(a.cursor);
  const b = await s.menuPage(a.cursor);
  assert.equal(b.items.length, 6);
  assert.equal(new Set([...a.items, ...b.items].map((x) => x.sku)).size, 56);
});
test("insufficient stock aborts all wallet and order writes", async () => {
  const s = await setup();
  await atomic(s.store, (tx) =>
    tx.put(key("core", `CUSTOMER#${customer.id}`), {
      id: customer.id,
      balancePaise: 10000,
    }),
  );
  await assert.rejects(
    place(
      s,
      customer,
      {
        ...body,
        useRewards: true,
        lines: [{ sku: "meal", quantity: 3, addons: [] }],
      },
      "aborted-checkout",
    ),
    /insufficient_stock/,
  );
  assert.equal((await s.wallet(customer)).balancePaise, 10000);
  assert.equal((await s.listOrders(customer)).items.length, 0);
});
test("runtime cannot enable ordering before policy review", () => {
  assert.throws(
    () =>
      runtimeConfig({
        ENVIRONMENT_NAME: "brekmate-production",
        CORE_TABLE: "c",
        LEDGER_TABLE: "l",
        OPERATIONS_TABLE: "o",
        CUSTOMER_ISSUER: "https://cognito-idp.ap-south-1.amazonaws.com/pool",
        STAFF_ISSUER: "https://cognito-idp.ap-south-1.amazonaws.com/staff",
        CUSTOMER_CLIENT_ID: "client",
        STAFF_CLIENT_ID: "staff",
        OUTLET_LATITUDE: "28.45",
        OUTLET_LONGITUDE: "77.02",
        OTP_SECRET_ARN:
          "arn:aws:secretsmanager:ap-south-1:123456789012:secret:brekmate-production/delivery-otp-abcdef",
        ORDERS_ENABLED: "true",
      }),
    /policies require explicit review/,
  );
});
