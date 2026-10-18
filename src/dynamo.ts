import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import type { Store, Table, Key, Change, Entity } from "./store.js";
export class DynamoStore implements Store {
  constructor(
    private tables: Record<Table, string>,
    private client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    }),
  ) {}
  async get(k: Key) {
    const r = await this.client.send(
      new GetCommand({
        TableName: this.tables[k.table],
        Key: { pk: k.pk, sk: k.sk },
        ConsistentRead: true,
      }),
    );
    return r.Item as Entity | undefined;
  }
  async query(table: Table, pk: string, prefix: string, cursor?: string) {
    const r = await this.client.send(
      new QueryCommand({
        TableName: this.tables[table],
        KeyConditionExpression: "pk = :p AND begins_with(sk, :s)",
        ExpressionAttributeValues: { ":p": pk, ":s": prefix },
        Limit: 50,
        ConsistentRead: true,
        ...(cursor ? { ExclusiveStartKey: { pk, sk: cursor } } : {}),
      }),
    );
    return {
      items: (r.Items ?? []) as Entity[],
      ...(r.LastEvaluatedKey
        ? { cursor: r.LastEvaluatedKey.sk as string }
        : {}),
    };
  }
  command(changes: Change[]): TransactWriteCommandInput {
    return {
      ClientRequestToken: randomUUID(),
      TransactItems: changes.map((c) => {
        const condition = {
          TableName: this.tables[c.key.table],
          ConditionExpression: c.before
            ? "#v = :v"
            : "attribute_not_exists(pk)",
          ...(c.before
            ? {
                ExpressionAttributeNames: { "#v": "version" },
                ExpressionAttributeValues: { ":v": c.before.version },
              }
            : {}),
        };
        return c.after
          ? { Put: { ...condition, Item: c.after } }
          : {
              ConditionCheck: {
                ...condition,
                Key: { pk: c.key.pk, sk: c.key.sk },
              },
            };
      }),
    };
  }
  async commit(changes: Change[]) {
    if (!changes.length) return true;
    try {
      await this.client.send(new TransactWriteCommand(this.command(changes)));
      return true;
    } catch (e: any) {
      if (e.name === "TransactionConflictException") return false;
      if (
        e.name === "TransactionCanceledException" &&
        Array.isArray(e.CancellationReasons) &&
        e.CancellationReasons.some((r: any) =>
          ["ConditionalCheckFailed", "TransactionConflict"].includes(r.Code),
        ) &&
        e.CancellationReasons.every((r: any) =>
          ["None", "ConditionalCheckFailed", "TransactionConflict"].includes(
            r.Code,
          ),
        )
      )
        return false;
      throw e;
    }
  }
}
