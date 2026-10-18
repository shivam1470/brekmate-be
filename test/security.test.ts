import { place } from "./fixtures.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { claimsActor, CognitoAuth } from "../src/auth.js";
import { runtimeConfig } from "../src/config.js";
import { DynamoStore } from "../src/dynamo.js";
import { atomic, key, MemoryStore } from "../src/store.js";
const claims = {
  sub: "identity-1",
  token_use: "access",
  client_id: "client",
  "cognito:groups": ["MANAGER", "unrecognised"],
};
test("verified customer claims cannot become staff through groups", () =>
  assert.deepEqual(claimsActor(claims, "customer", "client").roles, []));
test("staff groups are allowlisted", () =>
  assert.deepEqual(claimsActor(claims, "staff", "client").roles, ["MANAGER"]));
for (const changes of [
  { token_use: "id" },
  { client_id: "other" },
  { sub: "bad#identity" },
  { sub: undefined },
])
  test(`reject claims ${JSON.stringify(changes)}`, () =>
    assert.throws(() =>
      claimsActor({ ...claims, ...changes }, "staff", "client"),
    ));
test("auth does not trust arbitrary issuer URLs", () =>
  assert.throws(
    () =>
      new CognitoAuth(
        "https://attacker.test",
        "x",
        "https://attacker.test",
        "y",
      ),
  ));
test("production config fails closed with missing configuration", () =>
  assert.throws(() => runtimeConfig({})));
test("production config rejects local/test overrides", () =>
  assert.throws(() => runtimeConfig({ AUTH_MODE: "local" }), /forbidden/));
test("ledger overwrites are impossible through transaction API", async () => {
  const store = new MemoryStore();
  const k = key("ledger", "WALLET", "CREDIT");
  await atomic(store, (tx) => tx.put(k, { amountPaise: 100 }));
  await assert.rejects(
    atomic(store, (tx) => tx.put(k, { amountPaise: 1000 })),
    /ledger_immutable/,
  );
  assert.equal((await store.get(k))?.amountPaise, 100);
});
test("read-only dependencies are included in Dynamo transaction conditions", () => {
  const db = new DynamoStore({
    core: "core",
    ledger: "ledger",
    operations: "ops",
  });
  const command = db.command([
    {
      key: key("core", "A"),
      before: { pk: "A", sk: "META", version: 3 },
      after: undefined,
    },
    {
      key: key("ledger", "L"),
      before: undefined,
      after: { pk: "L", sk: "META", version: 1, amountPaise: 10 },
    },
  ]);
  assert.equal(
    command.TransactItems?.[0]?.ConditionCheck?.ConditionExpression,
    "#v = :v",
  );
  assert.equal(
    command.TransactItems?.[1]?.Put?.ConditionExpression,
    "attribute_not_exists(pk)",
  );
  assert.equal(command.TransactItems?.length, 2);
});

test("idempotent replay cannot bypass a staff role downgrade", async () => {
  const { Service } = await import("../src/service.js");
  const { fixtureConfig, manager, customer, seed } =
    await import("./fixtures.js");
  const service = new Service(new MemoryStore(), fixtureConfig);
  await seed(service);
  const o = await place(
    service,
    customer,
    {
      lines: [{ sku: "meal", quantity: 1, addons: [] }],
      fulfilment: "pickup",
      useRewards: false,
      payment: "COD",
    },
    "downgrade-order",
  );
  await service.transition(
    manager,
    o.id,
    { status: "accepted" },
    "downgrade-accept",
  );
  await assert.rejects(
    service.transition(
      { ...manager, roles: ["KITCHEN"] },
      o.id,
      { status: "accepted" },
      "downgrade-accept",
    ),
    /forbidden/,
  );
});
