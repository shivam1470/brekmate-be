import { place } from "./fixtures.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Service, type Actor } from "../src/service.js";
import { MemoryStore, atomic, key } from "../src/store.js";
import { customer, manager, fixtureConfig, seed } from "./fixtures.js";
const input = {
  lines: [{ sku: "meal", quantity: 1, addons: [] }],
  fulfilment: "pickup",
  useRewards: false,
  payment: "COD",
};
const setup = async () => {
  const store = new MemoryStore(),
    service = new Service(store, fixtureConfig);
  await seed(service);
  return { service, store };
};
async function ready(service: Service, id: string) {
  for (const status of ["accepted", "preparing", "ready"])
    await service.transition(manager, id, { status }, `status-${id}-${status}`);
}
async function delivered(service: Service, id: string) {
  await ready(service, id);
  await service.transition(
    manager,
    id,
    { status: "delivered" },
    `delivered-${id}`,
  );
}
test("referral reward waits for delivery AND exact COD collection, credits once", async () => {
  const { service } = await setup();
  const ref = { ...customer, id: "referrer" };
  const { code } = await service.referralCode(ref);
  await service.attributeReferral(customer, code, "attribution-key");
  const o = await place(service, customer, input, "referred-order");
  await delivered(service, o.id);
  assert.equal((await service.wallet(ref)).balancePaise, 0);
  await assert.rejects(
    service.collect(manager, o.id, 1, "wrong-collection"),
    /invalid_collection_amount/,
  );
  await service.collect(manager, o.id, 12000, "collect-payment");
  await service.collect(manager, o.id, 12000, "collect-payment");
  assert.equal((await service.wallet(ref)).balancePaise, 10000);
  assert.equal((await service.wallet(ref)).entries.length, 1);
});
test("self-referral denied and referral locked after order", async () => {
  const { service } = await setup();
  const own = await service.referralCode(customer);
  await assert.rejects(
    service.attributeReferral(customer, own.code, "self-referral"),
    /invalid_referral/,
  );
  const ref = await service.referralCode({ ...customer, id: "ref" });
  await place(service, customer, input, "lock-order-key");
  await assert.rejects(
    service.attributeReferral(customer, ref.code, "late-referral"),
    /referral_locked/,
  );
});
test("reward debit and cancellation restoration are atomic and immutable", async () => {
  const { service, store } = await setup();
  await atomic(store, (tx) =>
    tx.put(key("core", `CUSTOMER#${customer.id}`), {
      id: customer.id,
      balancePaise: 9000,
    }),
  );
  const o = await place(
    service,
    customer,
    { ...input, useRewards: true },
    "wallet-checkout",
  );
  assert.equal(o.rewardUsedPaise, 2400);
  assert.equal((await service.wallet(customer)).balancePaise, 6600);
  await service.transition(
    customer,
    o.id,
    { status: "cancelled" },
    "wallet-cancel-key",
  );
  assert.equal((await service.wallet(customer)).balancePaise, 9000);
  assert.equal((await service.wallet(customer)).entries.length, 2);
});
test("concurrent reward spending cannot double-spend available balance", async () => {
  const { service, store } = await setup();
  await atomic(store, (tx) =>
    tx.put(key("core", `CUSTOMER#${customer.id}`), {
      id: customer.id,
      balancePaise: 2400,
    }),
  );
  const results = await Promise.allSettled([
    place(
      service,
      customer,
      { ...input, useRewards: true },
      "wallet-concurrent1",
    ),
    place(
      service,
      customer,
      { ...input, useRewards: true },
      "wallet-concurrent2",
    ),
  ]);
  assert.equal(
    results.reduce(
      (sum, x) =>
        sum + (x.status === "fulfilled" ? x.value.rewardUsedPaise : 0),
      0,
    ),
    2400,
  );
  assert.equal((await service.wallet(customer)).balancePaise, 0);
});
test("COD cannot be collected before delivery or by unrelated rider", async () => {
  const { service } = await setup();
  const o = await place(service, customer, input, "cash-order-key");
  await assert.rejects(
    service.collect(manager, o.id, 12000, "cash-collect-key"),
    /invalid_collection/,
  );
  await delivered(service, o.id);
  const rider: Actor = { kind: "staff", id: "unrelated", roles: ["RIDER"] };
  await assert.rejects(
    service.collect(rider, o.id, 12000, "cash-collect-key2"),
    /forbidden/,
  );
});
test("delivery OTP belongs to customer and rider assignment is enforced", async () => {
  const { service } = await setup();
  const o = await place(
    service,
    customer,
    {
      ...input,
      fulfilment: "delivery",
      address: { line: "Test address", latitude: 28.45, longitude: 77.02 },
    },
    "delivery-order",
  );
  await ready(service, o.id);
  await service.registerRider(manager, "rider-1", true);
  await service.assign(manager, o.id, "rider-1", "assign-rider-key");
  await service.issueOtp(manager, o.id, "issue-delivery-otp");
  const rider: Actor = { kind: "staff", id: "rider-1", roles: ["RIDER"] };
  await assert.rejects(service.deliveryOtp(rider, o.id), /forbidden/);
  const { otp } = await service.deliveryOtp(customer, o.id);
  await service.transition(
    rider,
    o.id,
    { status: "out_for_delivery" },
    "rider-dispatch-key",
  );
  await assert.rejects(
    service.transition(
      rider,
      o.id,
      { status: "delivered", otp: "000000" },
      "wrong-otp-key",
    ),
    /invalid_otp/,
  );
  await service.transition(
    rider,
    o.id,
    { status: "delivered", otp },
    "correct-otp-key",
  );
  assert.equal((await service.order(customer, o.id)).status, "delivered");
  await assert.rejects(service.deliveryOtp(customer, o.id), /otp_unavailable/);
});
test("five invalid OTP attempts lock delivery verification", async () => {
  const { service } = await setup();
  const o = await place(
    service,
    customer,
    {
      ...input,
      fulfilment: "delivery",
      address: { line: "Test", latitude: 28.45, longitude: 77.02 },
    },
    "locked-delivery",
  );
  await ready(service, o.id);
  await service.registerRider(manager, "rider-1", true);
  await service.assign(manager, o.id, "rider-1", "lock-assign-key");
  await service.issueOtp(manager, o.id, "lock-issue-key");
  await service.transition(
    manager,
    o.id,
    { status: "out_for_delivery" },
    "lock-dispatch-key",
  );
  const { otp } = await service.deliveryOtp(customer, o.id);
  for (let i = 0; i < 5; i++)
    await assert.rejects(
      service.transition(
        manager,
        o.id,
        { status: "delivered", otp: "000000" },
        `lock-attempt-${i}`,
      ),
      /invalid_otp/,
    );
  await assert.rejects(
    service.deliveryOtp(customer, o.id),
    /otp_expired_or_locked/,
  );
  await assert.rejects(
    service.transition(
      manager,
      o.id,
      { status: "delivered", otp },
      "locked-correct-key",
    ),
    /otp_expired_or_locked/,
  );
});
test("closed cafe, unknown SKU and invalid addons are rejected", async () => {
  const { service } = await setup();
  await assert.rejects(
    service.basket(customer, {
      ...input,
      lines: [{ sku: "unknown", quantity: 1, addons: [] }],
    }),
    /product_unavailable/,
  );
  await assert.rejects(
    service.basket(customer, {
      ...input,
      lines: [{ sku: "meal", quantity: 1, addons: ["unknown"] }],
    }),
    /invalid_addon/,
  );
  await service.setOpen(manager, false);
  await assert.rejects(
    place(service, customer, input, "closed-order-key"),
    /outlet_closed/,
  );
});
test("booking consent is required for requested photo delivery", async () => {
  const { service } = await setup();
  await assert.rejects(
    service.enquire(
      customer,
      {
        occasion: "birthday",
        guests: 15,
        startsAt: "2030-01-01T12:00:00Z",
        endsAt: "2030-01-01T13:00:00Z",
        photoChannel: "email",
        photoConsent: false,
        photoContact: "a@example.test",
      },
      "no-consent-key",
    ),
  );
});
test("cancelled booking releases slots for another confirmation", async () => {
  const { service } = await setup();
  const b = {
    occasion: "office",
    guests: 20,
    startsAt: "2030-01-01T12:00:00Z",
    endsAt: "2030-01-01T13:00:00Z",
    photoChannel: "none",
    photoConsent: false,
  };
  const a = await service.enquire(customer, b, "booking-enquiry1"),
    c = await service.enquire(customer, b, "booking-enquiry2");
  await service.confirmBooking(manager, a.id, "booking-confirm1");
  await service.cancelBooking(manager, a.id, "booking-cancel1");
  await service.confirmBooking(manager, c.id, "booking-confirm2");
  assert.equal((await service.booking(customer, c.id)).status, "confirmed");
});
test("unapproved venue schedule disables confirmation, enquiries still work", async () => {
  const { service } = await setup();
  service.config = { ...service.config, bookingEnabled: false };
  const b = await service.enquire(
    customer,
    {
      occasion: "casual",
      guests: 10,
      startsAt: "2030-01-01T12:00:00Z",
      endsAt: "2030-01-01T13:00:00Z",
      photoChannel: "none",
      photoConsent: false,
    },
    "disabled-enquiry",
  );
  await assert.rejects(
    service.confirmBooking(manager, b.id, "disabled-confirm"),
    /booking_policy_not_configured/,
  );
});
test("support cannot attach another customers order", async () => {
  const { service } = await setup();
  const o = await place(service, customer, input, "support-order-key");
  await assert.rejects(
    service.ticket(
      { ...customer, id: "other" },
      { subject: "test", message: "test", orderId: o.id },
      "support-ticket-key",
    ),
    /forbidden/,
  );
});
