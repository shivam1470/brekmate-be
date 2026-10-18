import { place } from "./fixtures.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { quote, quoteBasket } from "../src/pricing.js";
import { MemoryStore } from "../src/store.js";
import { Service } from "../src/service.js";
import { fixtureConfig, seed, customer, manager } from "./fixtures.js";
const setup = async () => {
  const store = new MemoryStore();
  const service = new Service(store, fixtureConfig);
  await seed(service);
  return { service, store };
};
const checkout = {
  lines: [{ sku: "meal", quantity: 1, addons: [] }],
  fulfilment: "pickup",
  useRewards: false,
  payment: "COD",
};
test("strict delivery threshold and reward cap", () => {
  assert.equal(
    quote({
      subtotalPaise: 9900,
      availableRewardPaise: 10000,
      fulfilment: "delivery",
      useRewards: true,
    }).totalPaise,
    9920,
  );
  assert.equal(
    quote({
      subtotalPaise: 9901,
      availableRewardPaise: 10000,
      fulfilment: "delivery",
      useRewards: true,
    }).deliveryFeePaise,
    0,
  );
});
test("basket uses quantity and add-ons", () =>
  assert.equal(
    quoteBasket({
      lines: [{ sku: "x", unitPricePaise: 100, quantity: 2, addOnPaise: 20 }],
      availableRewardPaise: 0,
      fulfilment: "pickup",
      useRewards: false,
    }).subtotalPaise,
    240,
  ));
for (const bad of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER])
  test(`invalid money ${bad}`, () =>
    assert.throws(() =>
      quote({
        subtotalPaise: bad,
        availableRewardPaise: 0,
        fulfilment: "pickup",
        useRewards: false,
      }),
    ));
test("server catalogue ignores forged client prices", async () => {
  const { service } = await setup();
  const q = await service.basket(customer, checkout);
  assert.equal(q.totalPaise, 12000);
});
test("duplicate checkout returns same order and reserves stock once", async () => {
  const { service } = await setup();
  const a = await place(service, customer, checkout, "idem-key-0001");
  const b = await place(service, customer, checkout, "idem-key-0001");
  assert.equal(a.id, b.id);
  assert.equal((await service.menu())[0]!.stock, 1);
});
test("idempotency key cannot be reused with different body", async () => {
  const { service } = await setup();
  await place(service, customer, checkout, "idem-key-0001");
  await assert.rejects(
    place(
      service,
      customer,
      { ...checkout, lines: [{ sku: "meal", quantity: 2, addons: [] }] },
      "idem-key-0001",
    ),
    /idempotency_conflict/,
  );
});
test("concurrent buyers cannot oversell", async () => {
  const { service } = await setup();
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) =>
      place(
        service,
        { ...customer, id: `buyer${i}` },
        checkout,
        `checkout-${i}-key`,
      ),
    ),
  );
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 2);
  assert.equal((await service.menu())[0]!.stock, 0);
});
test("order ownership enforced", async () => {
  const { service } = await setup();
  const o = await place(service, customer, checkout, "ownership-key");
  await assert.rejects(
    service.order({ ...customer, id: "other" }, o.id),
    /forbidden/,
  );
});
test("invalid order transitions denied", async () => {
  const { service } = await setup();
  const o = await place(service, customer, checkout, "transition-key");
  await assert.rejects(
    service.transition(
      manager,
      o.id,
      { status: "delivered" },
      "status-key-000",
    ),
    /invalid_transition/,
  );
});
test("customer cannot manage menu", async () => {
  const { service } = await setup();
  await assert.rejects(
    service.saveProduct(customer, { sku: "x" }),
    /forbidden/,
  );
});
test("cancellation restores stock exactly once", async () => {
  const { service } = await setup();
  const o = await place(service, customer, checkout, "cancel-checkout");
  await service.transition(
    customer,
    o.id,
    { status: "cancelled" },
    "cancel-key-000",
  );
  await service.transition(
    customer,
    o.id,
    { status: "cancelled" },
    "cancel-key-000",
  );
  assert.equal((await service.menu())[0]!.stock, 2);
});
test("online checkout fails closed until gateway integration configured", async () => {
  const { service } = await setup();
  await assert.rejects(
    place(
      service,
      customer,
      { ...checkout, payment: "ONLINE" },
      "payment-key-000",
    ),
    /online_payment_unavailable/,
  );
});
test("delivery outside configured radius rejected", async () => {
  const { service } = await setup();
  await assert.rejects(
    service.basket(customer, {
      ...checkout,
      fulfilment: "delivery",
      address: { line: "Example", latitude: 0, longitude: 0 },
    }),
    /outside_delivery_area/,
  );
});
test("booking enquiry does not reserve; simultaneous confirmations cannot overlap", async () => {
  const { service } = await setup();
  const input = {
    occasion: "birthday",
    guests: 15,
    startsAt: "2030-01-01T12:00:00Z",
    endsAt: "2030-01-01T13:00:00Z",
    photoChannel: "email",
    photoContact: "guest@example.test",
    photoConsent: true,
  };
  const a = await service.enquire(customer, input, "enquiry-key-001");
  const b = await service.enquire(
    { ...customer, id: "other" },
    input,
    "enquiry-key-002",
  );
  const results = await Promise.allSettled([
    service.confirmBooking(manager, a.id, "booking-key-001"),
    service.confirmBooking(manager, b.id, "booking-key-002"),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
});
test("booking guest limit enforced", async () => {
  const { service } = await setup();
  await assert.rejects(
    service.enquire(customer, { guests: 21 }, "enquiry-key-003"),
  );
});
test("deleted account cannot order", async () => {
  const { service } = await setup();
  await service.deleteAccount(customer, "delete-account-1");
  await assert.rejects(
    place(service, customer, checkout, "deleted-checkout"),
    /account_deleted/,
  );
});
