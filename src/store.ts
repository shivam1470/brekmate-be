import { randomUUID } from "node:crypto";
import { Fault, requireThat } from "./errors.js";
export type Table = "core" | "ledger" | "operations";
export type Entity = {
  pk: string;
  sk: string;
  version: number;
  [key: string]: any;
};
export type Key = { table: Table; pk: string; sk: string };
export type Change = {
  key: Key;
  before: Entity | undefined;
  after: Entity | undefined;
};
export interface Store {
  get(key: Key): Promise<Entity | undefined>;
  query(
    table: Table,
    pk: string,
    prefix: string,
    cursor?: string,
  ): Promise<{ items: Entity[]; cursor?: string }>;
  commit(changes: Change[]): Promise<boolean>;
}
export const key = (table: Table, pk: string, sk = "META"): Key => ({
  table,
  pk,
  sk,
});
const address = (k: Key) => JSON.stringify([k.table, k.pk, k.sk]);
export class Transaction {
  private reads = new Map<string, { key: Key; before: Entity | undefined }>();
  private writes = new Map<string, Entity>();
  constructor(private store: Store) {}
  async get(k: Key) {
    const id = address(k);
    if (this.writes.has(id)) return structuredClone(this.writes.get(id));
    if (!this.reads.has(id))
      this.reads.set(id, { key: k, before: await this.store.get(k) });
    return structuredClone(this.reads.get(id)!.before);
  }
  async put(k: Key, data: Record<string, any>) {
    const before = await this.get(k);
    if (k.table === "ledger") requireThat(!before, "ledger_immutable");
    this.writes.set(address(k), {
      ...structuredClone(data),
      pk: k.pk,
      sk: k.sk,
      version: (this.reads.get(address(k))!.before?.version ?? 0) + 1,
    });
  }
  changes() {
    return [...this.reads.entries()].map(([id, r]) => ({
      ...r,
      after: this.writes.get(id),
    }));
  }
}
export async function atomic<T>(
  store: Store,
  run: (tx: Transaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const tx = new Transaction(store);
    const result = await run(tx);
    const changes = tx.changes();
    requireThat(changes.length <= 100, "transaction_too_large", 400);
    if (await store.commit(changes)) return result;
    await new Promise((r) => setTimeout(r, Math.min(30, attempt * 2)));
  }
  throw new Fault(409, "concurrent_update_retry");
}
export class MemoryStore implements Store {
  private rows = new Map<string, Entity>();
  async get(k: Key) {
    return structuredClone(this.rows.get(address(k)));
  }
  async query(table: Table, pk: string, prefix: string, cursor?: string) {
    const rows = [...this.rows.entries()]
      .filter(
        ([a, e]) =>
          JSON.parse(a)[0] === table &&
          e.pk === pk &&
          e.sk.startsWith(prefix) &&
          (!cursor || e.sk > cursor),
      )
      .map(([, e]) => e)
      .sort((a, b) => a.sk.localeCompare(b.sk));
    const items = rows.slice(0, 50);
    return {
      items: structuredClone(items),
      ...(rows.length > 50 ? { cursor: items.at(-1)!.sk } : {}),
    };
  }
  async commit(changes: Change[]) {
    for (const c of changes)
      if (this.rows.get(address(c.key))?.version !== c.before?.version)
        return false;
    for (const c of changes)
      if (c.after) this.rows.set(address(c.key), structuredClone(c.after));
    return true;
  }
}
export const identifier = () => randomUUID();
