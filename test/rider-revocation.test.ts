import { test } from "node:test";
import assert from "node:assert/strict";
import { Service, type Actor } from "../src/service.js";
import { MemoryStore } from "../src/store.js";
import { fixtureConfig, customer, manager, seed, place } from "./fixtures.js";
const rider: Actor = { kind: "staff", id: "rider-1", roles: ["RIDER"] };
async function delivered() {
  const s = new Service(new MemoryStore(), fixtureConfig);
  await seed(s);
  await s.registerRider(manager, rider.id, true, "Fixture Rider");
  const o = await place(
    s,
    customer,
    {
      lines: [{ sku: "meal", quantity: 1, addons: [] }],
      fulfilment: "delivery",
      useRewards: false,
      payment: "COD",
      address: { line: "Fixture office", latitude: 28.45, longitude: 77.02 },
    },
    "revocation-checkout",
  );
  await s.assign(manager, o.id, rider.id, "assign-rider-key");
  for (const status of ["accepted", "preparing", "ready"])
    await s.transition(manager, o.id, { status }, "status-" + status);
  await s.issueOtp(manager, o.id, "issue-otp-key");
  await s.transition(
    rider,
    o.id,
    { status: "out_for_delivery" },
    "dispatch-key",
  );
  const { otp } = await s.deliveryOtp(customer, o.id);
  return { s, o, otp };
}
test("deactivated rider loses assigned-order and rider-queue reads with an otherwise valid identity", async () => {
  const { s, o } = await delivered();
  await s.registerRider(manager, rider.id, false);
  await assert.rejects(s.order(rider, o.id), /rider_not_active/);
  await assert.rejects(s.riderOrders(rider), /rider_not_active/);
  assert.equal((await s.order(manager, o.id)).id, o.id);
});
test("deactivated rider cannot complete delivery or replay a previous dispatch", async () => {
  const { s, o, otp } = await delivered();
  await s.registerRider(manager, rider.id, false);
  await assert.rejects(
    s.transition(rider, o.id, { status: "delivered", otp }, "delivery-key"),
    /rider_not_active/,
  );
  await assert.rejects(
    s.transition(rider, o.id, { status: "out_for_delivery" }, "dispatch-key"),
    /rider_not_active/,
  );
});
test("deactivated rider cannot collect cash or replay their prior collection", async () => {
  const { s, o, otp } = await delivered();
  await s.transition(rider, o.id, { status: "delivered", otp }, "delivery-key");
  await s.collect(rider, o.id, o.totalPaise, "cash-key");
  await s.registerRider(manager, rider.id, false);
  await assert.rejects(
    s.collect(rider, o.id, o.totalPaise, "cash-key"),
    /rider_not_active/,
  );
});
