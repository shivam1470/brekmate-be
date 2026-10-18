import { test } from "node:test";
import assert from "node:assert/strict";
import { Service } from "../src/service.js";
import { MemoryStore } from "../src/store.js";
import { fixtureConfig, seed, manager, customer, place } from "./fixtures.js";
async function setup() {
  const s = new Service(new MemoryStore(), fixtureConfig);
  await seed(s);
  return s;
}
const body = {
  lines: [{ sku: "meal", quantity: 1, addons: [] }],
  fulfilment: "pickup",
  useRewards: false,
  payment: "COD",
};
function editable(p: any) {
  const { revision, ...fields } = p;
  return fields;
}
test("old clients cannot overwrite stock using an unversioned edit after checkout", async () => {
  const s = await setup(),
    before = (await s.menu())[0]!;
  await place(s, customer, body, "stock-checkout");
  await assert.rejects(
    s.saveProduct(manager, editable(before)),
    /product_changed/,
  );
  assert.equal((await s.menu())[0]!.stock, 1);
});
test("two concurrent catalogue edits of the same revision cannot overwrite each other", async () => {
  const s = await setup(),
    before = (await s.menu())[0]!;
  const results = await Promise.allSettled(
    [1, 2].map((stock) =>
      s.saveProduct(manager, {
        ...editable(before),
        stock,
        expectedVersion: before.revision,
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
});
test("freshly loaded revision can explicitly set remaining stock and increments revision", async () => {
  const s = await setup(),
    before = (await s.menu())[0]!;
  await s.saveProduct(manager, {
    ...editable(before),
    stock: 7,
    expectedVersion: before.revision,
  });
  const after = (await s.menu())[0]!;
  assert.equal(after.stock, 7);
  assert.equal(after.revision, before.revision + 1);
});
