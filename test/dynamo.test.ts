import { test } from "node:test";
import assert from "node:assert/strict";
import { DynamoStore } from "../src/dynamo.js";
import { key } from "../src/store.js";
const tables = {
  core: "core-table",
  ledger: "ledger-table",
  operations: "operations-table",
};
test("Dynamo gets and paginated queries use strong reads and table key conditions", async () => {
  const commands: any[] = [];
  const client = {
    async send(command: any) {
      commands.push(command.input);
      return commands.length === 1
        ? { Item: { pk: "A", sk: "META", version: 1 } }
        : { Items: [], LastEvaluatedKey: { pk: "A", sk: "ORDER#end" } };
    },
  };
  const store = new DynamoStore(tables, client as any);
  await store.get(key("core", "A"));
  const r = await store.query("core", "A", "ORDER#", "ORDER#start");
  assert.equal(commands[0].ConsistentRead, true);
  assert.equal(commands[0].TableName, "core-table");
  assert.equal(commands[1].ConsistentRead, true);
  assert.deepEqual(commands[1].ExclusiveStartKey, {
    pk: "A",
    sk: "ORDER#start",
  });
  assert.equal(r.cursor, "ORDER#end");
});
for (const [name, codes, retry] of [
  ["TransactionConflictException", undefined, true],
  ["TransactionCanceledException", ["ConditionalCheckFailed", "None"], true],
  ["TransactionCanceledException", ["ProvisionedThroughputExceeded"], false],
  ["AccessDeniedException", undefined, false],
] as const)
  test(`Dynamo preserves retry/error semantics ${name} ${codes}`, async () => {
    const error = Object.assign(new Error("fixture"), {
      name,
      ...(codes
        ? { CancellationReasons: codes.map((Code) => ({ Code })) }
        : {}),
    });
    const store = new DynamoStore(tables, {
      async send() {
        throw error;
      },
    } as any);
    const write = [
      {
        key: key("core", "A"),
        before: undefined,
        after: { pk: "A", sk: "META", version: 1 },
      },
    ];
    if (retry) assert.equal(await store.commit(write), false);
    else await assert.rejects(store.commit(write), (e) => e === error);
  });
