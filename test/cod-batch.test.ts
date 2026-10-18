import { test } from "node:test";
import assert from "node:assert/strict";
import { Service, type Actor } from "../src/service.js";
import { MemoryStore, atomic, key } from "../src/store.js";
import { fixtureConfig, customer, manager, seed } from "./fixtures.js";
const body = {
  lines: [{ sku: "meal", quantity: 1, addons: [] }],
  fulfilment: "pickup",
  useRewards: false,
  payment: "COD",
};
const address = {
  line: "Synthetic office",
  latitude: 28.45,
  longitude: 77.02,
  recipientName: "Fixture Customer",
  phone: "+919876543210",
  floor: "2",
  landmark: "Reception",
};
async function setup() {
  let time = new Date("2029-01-01T00:00:00Z");
  const s = new Service(new MemoryStore(), {
    ...fixtureConfig,
    now: () => time,
  });
  await seed(s);
  return {
    s,
    setTime: (value: string) => {
      time = new Date(value);
    },
    quoted: async (input: any = body) => ({
      ...input,
      quoteToken: (await s.basket(customer, input)).quoteToken,
    }),
  };
}
test("COD requires accepted server quote before any stock writes", async () => {
  const { s } = await setup();
  await assert.rejects(s.checkout(customer, body, "missing-quote"));
  assert.equal((await s.listOrders(customer)).items.length, 0);
});
test("changed price is rejected without stock reservation", async () => {
  const { s, quoted } = await setup();
  const input = await quoted();
  await s.saveProduct(manager, {
    expectedVersion: (await s.menu())[0]!.revision,
    sku: "meal",
    name: "Meal",
    category: "Meals",
    pricePaise: 15000,
    stock: 2,
    available: true,
    vegetarian: true,
    addons: { cheese: 2000 },
  });
  await assert.rejects(
    s.checkout(customer, input, "changed-price"),
    /quote_changed/,
  );
  assert.equal((await s.menu())[0]!.stock, 2);
});
test("expired quote rejects new attempts but accepted replay returns original order", async () => {
  const { s, quoted, setTime } = await setup();
  const input = await quoted();
  const o = await s.checkout(customer, input, "accepted-quote");
  setTime("2029-01-01T00:11:00Z");
  assert.equal((await s.checkout(customer, input, "accepted-quote")).id, o.id);
  await assert.rejects(
    s.checkout(customer, input, "expired-quote"),
    /quote_expired/,
  );
});
test("quote binds identity and basket options", async () => {
  const { s, quoted } = await setup();
  const input = await quoted();
  await assert.rejects(
    s.checkout({ ...customer, id: "other" }, input, "wrong-customer"),
    /quote_changed/,
  );
  await assert.rejects(
    s.checkout(
      customer,
      {
        ...input,
        lines: [
          { sku: "meal", quantity: 1, addons: [], instructions: "different" },
        ],
      },
      "wrong-options",
    ),
    /quote_changed/,
  );
});
test("quote cannot be forged", async () => {
  const { s, quoted } = await setup();
  const input = await quoted();
  await assert.rejects(
    s.checkout(
      customer,
      { ...input, quoteToken: input.quoteToken.slice(0, -1) + "x" },
      "forged-quote",
    ),
    /invalid_quote/,
  );
});
test("changed wallet balance requires renewed quote consent", async () => {
  const { s, quoted } = await setup();
  const input = await quoted({ ...body, useRewards: true });
  await atomic(s.store, (tx) =>
    tx.put(key("core", `CUSTOMER#${customer.id}`), {
      id: customer.id,
      balancePaise: 10000,
    }),
  );
  await assert.rejects(
    s.checkout(customer, input, "changed-wallet"),
    /quote_changed/,
  );
});
test("reconciliation distinguishes unknown accepted and safely abandoned attempts", async () => {
  const { s, quoted } = await setup();
  assert.equal(
    (await s.reconcileCheckout(customer, "unknown-attempt")).state,
    "unknown",
  );
  assert.equal(
    (await s.reconcileCheckout(customer, "unknown-attempt", true)).state,
    "abandoned",
  );
  const input = await quoted();
  await assert.rejects(
    s.checkout(customer, input, "unknown-attempt"),
    /checkout_abandoned/,
  );
  const o = await s.checkout(customer, input, "accepted-attempt");
  assert.equal(
    (await s.reconcileCheckout(customer, "accepted-attempt", true)).orderId,
    o.id,
  );
  assert.equal(
    (
      await s.reconcileCheckout(
        { ...customer, id: "other" },
        "accepted-attempt",
      )
    ).state,
    "unknown",
  );
});
test("late checkout racing abandonment cannot produce an unknown accepted order", async () => {
  const { s, quoted } = await setup();
  const input = await quoted();
  await Promise.allSettled([
    s.checkout(customer, input, "racing-attempt"),
    s.reconcileCheckout(customer, "racing-attempt", true),
  ]);
  const result = await s.reconcileCheckout(customer, "racing-attempt");
  assert.equal(
    (await s.listOrders(customer)).items.length,
    result.state === "accepted" ? 1 : 0,
  );
});
test("delivery contact is validated and retained in the order snapshot", async () => {
  const { s, quoted } = await setup();
  await s.saveAddress(customer, "office", address);
  const o = await s.checkout(
    customer,
    await quoted({ ...body, fulfilment: "delivery", address }),
    "address-order",
  );
  assert.equal(o.address!.phone, address.phone);
  await assert.rejects(
    s.saveAddress(customer, "bad", { ...address, phone: "invalid" }),
  );
});
test("legacy coordinate-only delivery requires recipient contact", async () => {
  const { s } = await setup();
  await assert.rejects(
    s.basket(customer, {
      ...body,
      fulfilment: "delivery",
      address: { line: "Legacy", latitude: 28.45, longitude: 77.02 },
    }),
    /delivery_contact_required/,
  );
});
test("serviceability checks configured radius early", async () => {
  const { s } = await setup();
  assert.equal(
    (await s.serviceability(customer, { latitude: 28.45, longitude: 77.02 }))
      .deliverable,
    true,
  );
  assert.equal(
    (await s.serviceability(customer, { latitude: 0, longitude: 0 }))
      .deliverable,
    false,
  );
});
test("cash collection index uses IST collection day and records retries once", async () => {
  const { s, quoted, setTime } = await setup();
  const o = await s.checkout(customer, await quoted(), "cash-order-key");
  for (const status of ["accepted", "preparing", "ready", "delivered"])
    await s.transition(manager, o.id, { status }, "cash-status-" + status);
  setTime("2029-01-01T20:00:00Z");
  await s.collect(manager, o.id, 12000, "cash-collected");
  await s.collect(manager, o.id, 12000, "cash-collected");
  const report = await s.cashCollections(manager, "2029-01-02");
  assert.equal(report.items.length, 1);
  assert.equal(report.items[0]!.amountPaise, 12000);
  assert.equal(
    (await s.cashCollections(manager, "2029-01-01")).items.length,
    0,
  );
  await assert.rejects(s.cashCollections(customer, "2029-01-02"), /forbidden/);
});
test("dispatch directory lists rider names and denies customer access", async () => {
  const { s } = await setup();
  await s.registerRider(manager, "rider-1", true, "Rider One");
  assert.equal((await s.riders(manager)).items[0]!.name, "Rider One");
  await assert.rejects(s.riders(customer), /forbidden/);
});
async function readyDelivery(s: Service, input: any) {
  const q = await s.basket(customer, input);
  const o = await s.checkout(
    customer,
    { ...input, quoteToken: q.quoteToken },
    "delivery-order-key",
  );
  for (const status of ["accepted", "preparing", "ready"])
    await s.transition(manager, o.id, { status }, "delivery-status-" + status);
  await s.registerRider(manager, "rider-1", true);
  await s.assign(manager, o.id, "rider-1", "delivery-assignment");
  return o;
}
const rider: Actor = { kind: "staff", id: "rider-1", roles: ["RIDER"] };
test("delivery issue flags a delivery without cash or handoff effects", async () => {
  const { s } = await setup();
  const o = await readyDelivery(s, {
    ...body,
    fulfilment: "delivery",
    address,
  });
  await s.deliveryIssue(
    rider,
    o.id,
    { reason: "customer_unreachable", note: "Reception did not answer" },
    "issue-report-key",
  );
  const result = await s.order(customer, o.id);
  assert.equal(result.status, "ready");
  assert.equal(result.paymentStatus, "due");
  await assert.rejects(
    s.deliveryIssue(
      { ...rider, id: "other" },
      o.id,
      { reason: "other", note: "bad" },
      "unassigned-report",
    ),
    /forbidden/,
  );
});
test("café can renew a late OTP with a reason but rider cannot", async () => {
  const { s, setTime } = await setup();
  const o = await readyDelivery(s, {
    ...body,
    fulfilment: "delivery",
    address,
  });
  await s.issueOtp(manager, o.id, "delivery-otp-key");
  await s.transition(
    manager,
    o.id,
    { status: "out_for_delivery" },
    "delivery-dispatch",
  );
  setTime("2029-01-01T00:31:00Z");
  await assert.rejects(
    s.issueOtp(manager, o.id, "renew-no-reason"),
    /reason_required/,
  );
  await assert.rejects(
    s.issueOtp(rider, o.id, "renew-rider-key", "Customer waiting"),
    /forbidden/,
  );
  await s.issueOtp(
    manager,
    o.id,
    "renew-cafe-key",
    "Delay confirmed with customer",
  );
  await s.transition(
    manager,
    o.id,
    { status: "delivered", otp: (await s.deliveryOtp(customer, o.id)).otp },
    "late-handoff-key",
  );
  assert.equal((await s.order(customer, o.id)).status, "delivered");
});
