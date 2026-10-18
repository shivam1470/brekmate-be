import {
  createHash,
  createHmac,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { Fault, requireThat } from "./errors.js";
import {
  atomic,
  key,
  identifier,
  type Store,
  type Transaction,
  type Entity,
} from "./store.js";
import { quoteBasket } from "./pricing.js";
import * as schemas from "./schemas.js";
export type Actor = { kind: "customer" | "staff"; id: string; roles: string[] };
export type Config = {
  outletId: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  ordersEnabled: boolean;
  bookingEnabled: boolean;
  bookingMaxMinutes: number;
  bookingBufferMinutes: number;
  openingUtcHour: number;
  closingUtcHour: number;
  otpPepper: string;
  pickupAddress?: string;
  now: () => Date;
};
const digest = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
function canonical(v: any): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
export const can = (a: Actor, roles: string[]) =>
  a.kind === "staff" && a.roles.some((r) => roles.includes(r));
export function staff(a: Actor, roles = ["OWNER", "MANAGER"]) {
  requireThat(can(a, roles), "forbidden", 403);
}
const ckey = (id: string) => key("core", `CUSTOMER#${id}`);
const okey = (id: string) => key("core", `ORDER#${id}`);
const publicEntity = (e: Entity) => {
  const { pk, sk, version, otpHash, otpAttempts, otpExpires, ...publicData } =
    e;
  return publicData;
};
const publicProduct = (p: Entity) => ({
  ...schemas.productSchema.parse(publicEntity(p)),
  revision: p.version,
});
export class Service {
  constructor(
    public store: Store,
    public config: Config,
  ) {}
  private now() {
    return this.config.now().toISOString();
  }
  private menuKey(sku: string) {
    return key("core", `MENU#${this.config.outletId}`, `PRODUCT#${sku}`);
  }
  private async active(tx: Transaction, a: Actor) {
    requireThat(a.kind === "customer", "customer_required", 403);
    const c = await tx.get(ckey(a.id));
    requireThat(!c?.deletedAt, "account_deleted", 403);
    return (
      c ??
      ({
        id: a.id,
        balancePaise: 0,
        pk: `CUSTOMER#${a.id}`,
        sk: "META",
        version: 0,
      } as Entity)
    );
  }
  private async execute<T>(
    a: Actor,
    operation: string,
    idempotency: string,
    body: unknown,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    requireThat(
      /^[A-Za-z0-9_-]{8,128}$/.test(idempotency),
      "idempotency_key_required",
      400,
    );
    const fingerprint = digest(body);
    const k = key(
      "operations",
      `IDEMPOTENCY#${a.kind}#${a.id}`,
      `${operation}#${idempotency}`,
    );
    return atomic(this.store, async (tx) => {
      if (a.kind === "customer") await this.active(tx, a);
      await this.activeRider(tx, a);
      const previous = await tx.get(k);
      if (previous) {
        requireThat(!previous.abandoned, "checkout_abandoned");
        requireThat(
          previous.fingerprint === fingerprint,
          "idempotency_conflict",
        );
        return structuredClone(previous.result) as T;
      }
      const result = await fn(tx);
      await tx.put(k, { fingerprint, result, createdAt: this.now() });
      return result;
    });
  }
  private async activeRider(tx: Transaction, a: Actor) {
    if (can(a, ["RIDER"]) && !can(a, ["OWNER", "MANAGER", "OPERATOR"]))
      requireThat(
        (await tx.get(key("core", `RIDER#${a.id}`)))?.active === true,
        "rider_not_active",
        403,
      );
  }
  private async audit(
    tx: Transaction,
    a: Actor,
    event: string,
    entity: string,
  ) {
    await tx.put(
      key(
        "operations",
        `AUDIT#${this.now().slice(0, 10)}`,
        `${this.now()}#${identifier()}`,
      ),
      { actorId: a.id, actorKind: a.kind, event, entity, at: this.now() },
    );
  }
  async menu(cursor?: string) {
    return (
      await this.store.query(
        "core",
        `MENU#${this.config.outletId}`,
        "PRODUCT#",
        cursor,
      )
    ).items.map(publicProduct);
  }
  async menuPage(cursor?: string) {
    const r = await this.store.query(
      "core",
      `MENU#${this.config.outletId}`,
      "PRODUCT#",
      cursor,
    );
    return { ...r, items: r.items.map(publicProduct) };
  }
  async saveProduct(a: Actor, input: unknown) {
    staff(a);
    const { expectedVersion, ...p } = schemas.productSchema.parse(input);
    return atomic(this.store, async (tx) => {
      const previous = await tx.get(this.menuKey(p.sku));
      requireThat(
        previous ? expectedVersion === previous.version : !expectedVersion,
        "product_changed",
        409,
      );
      await tx.put(this.menuKey(p.sku), p);
      await this.audit(tx, a, "menu.updated", p.sku);
      return { ...p, revision: (previous?.version ?? 0) + 1 };
    });
  }
  async setOpen(a: Actor, open: boolean) {
    staff(a);
    requireThat(typeof open === "boolean", "invalid_open", 400);
    return atomic(this.store, async (tx) => {
      await tx.put(key("core", `OUTLET#${this.config.outletId}`), { open });
      await this.audit(tx, a, "outlet.availability", this.config.outletId);
      return { open };
    });
  }
  private distance(lat: number, lon: number) {
    const rad = (x: number) => (x * Math.PI) / 180;
    const a =
      Math.sin(rad(lat - this.config.latitude) / 2) ** 2 +
      Math.cos(rad(lat)) *
        Math.cos(rad(this.config.latitude)) *
        Math.sin(rad(lon - this.config.longitude) / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  private async priced(tx: Transaction, a: Actor, b: any) {
    const customer = await this.active(tx, a);
    requireThat(this.config.ordersEnabled, "orders_disabled", 503);
    const outlet = await tx.get(key("core", `OUTLET#${this.config.outletId}`));
    requireThat(outlet?.open !== false, "outlet_closed");
    if (b.fulfilment === "delivery") {
      requireThat(b.address, "delivery_address_required", 400);
      requireThat(
        this.distance(b.address.latitude, b.address.longitude) <=
          this.config.radiusKm,
        "outside_delivery_area",
        422,
      );
    }
    if (b.fulfilment === "delivery")
      requireThat(
        b.address?.recipientName && b.address?.phone,
        "delivery_contact_required",
        400,
      );
    const seen = new Set<string>();
    const lines = [];
    for (const line of b.lines) {
      requireThat(!seen.has(line.sku), "duplicate_product", 400);
      seen.add(line.sku);
      const p = await tx.get(this.menuKey(line.sku));
      requireThat(p?.available && p.vegetarian === true, "product_unavailable");
      requireThat(p.stock >= line.quantity, "insufficient_stock");
      requireThat(
        new Set(line.addons).size === line.addons.length,
        "duplicate_addon",
        400,
      );
      let addOnPaise = 0;
      for (const addon of line.addons) {
        requireThat(Object.hasOwn(p.addons, addon), "invalid_addon", 400);
        addOnPaise += p.addons[addon];
      }
      lines.push({
        ...line,
        name: p.name,
        unitPricePaise: p.pricePaise,
        addOnPaise,
      });
    }
    return {
      lines,
      pricing: quoteBasket({
        lines,
        fulfilment: b.fulfilment,
        useRewards: b.useRewards,
        availableRewardPaise: customer.balancePaise ?? 0,
      }),
    };
  }
  async basket(a: Actor, input: unknown) {
    const b = schemas.basketSchema.parse(
      Object.fromEntries(
        Object.entries(input as any).filter(([k]) => k !== "payment"),
      ),
    );
    return atomic(this.store, async (tx) => {
      const priced = await this.priced(tx, a, b);
      const expiresAt = Math.floor(this.config.now().getTime() / 1000) + 600;
      const payload = `${expiresAt}.${digest({ customerId: a.id, basket: b, ...priced })}`;
      const signature = createHmac("sha256", this.config.otpPepper)
        .update("brekmate-quote-v1:" + payload)
        .digest("hex");
      return {
        ...priced.pricing,
        expiresAt,
        quoteToken: `${payload}.${signature}`,
      };
    });
  }
  async checkout(a: Actor, input: unknown, idempotency: string) {
    const b = schemas.checkoutSchema.parse(input);
    requireThat(b.payment === "COD", "online_payment_unavailable", 503);
    return this.execute(a, "checkout", idempotency, b, async (tx) => {
      const { lines, pricing } = await this.priced(tx, a, b);
      const { payment, quoteToken, ...basket } = b;
      requireThat(quoteToken, "quote_required", 400);
      const parts = quoteToken.split(".");
      requireThat(
        parts.length === 3 &&
          /^\d{10}$/.test(parts[0]!) &&
          /^[a-f0-9]{64}$/.test(parts[1]!) &&
          /^[a-f0-9]{64}$/.test(parts[2]!),
        "invalid_quote",
        400,
      );
      const signature = createHmac("sha256", this.config.otpPepper)
        .update("brekmate-quote-v1:" + parts.slice(0, 2).join("."))
        .digest("hex");
      requireThat(
        timingSafeEqual(Buffer.from(signature), Buffer.from(parts[2]!)),
        "invalid_quote",
        400,
      );
      requireThat(
        Number(parts[0]) > Math.floor(this.config.now().getTime() / 1000),
        "quote_expired",
      );
      requireThat(
        parts[1] === digest({ customerId: a.id, basket, lines, pricing }),
        "quote_changed",
      );
      const c = await this.active(tx, a);
      const id = identifier();
      for (const line of lines) {
        const k = this.menuKey(line.sku);
        const p = (await tx.get(k))!;
        await tx.put(k, { ...p, stock: p.stock - line.quantity });
      }
      await tx.put(ckey(a.id), {
        ...c,
        firstOrderId: c.firstOrderId ?? id,
        balancePaise: (c.balancePaise ?? 0) - pricing.rewardUsedPaise,
      });
      if (pricing.rewardUsedPaise)
        await tx.put(key("ledger", `CUSTOMER#${a.id}`, `ORDER#${id}#REDEEM`), {
          amountPaise: -pricing.rewardUsedPaise,
          orderId: id,
          at: this.now(),
          type: "redemption",
        });
      const order = {
        id,
        customerId: a.id,
        outletId: this.config.outletId,
        lines,
        ...pricing,
        payment: "COD",
        paymentStatus: "due",
        status: "placed",
        fulfilment: b.fulfilment,
        ...(b.address ? { address: b.address } : {}),
        createdAt: this.now(),
        updatedAt: this.now(),
      };
      await tx.put(okey(id), order);
      await tx.put(key("core", `CUSTOMER#${a.id}`, `ORDER#${id}`), { id });
      await tx.put(
        key("core", `OUTLET#${this.config.outletId}`, `ORDER#${id}`),
        { id },
      );
      await this.audit(tx, a, "order.placed", id);
      return order;
    });
  }
  async reconcileCheckout(a: Actor, attempt: string, abandon = false) {
    requireThat(
      /^[A-Za-z0-9_-]{8,128}$/.test(attempt),
      "idempotency_key_required",
      400,
    );
    return atomic(this.store, async (tx) => {
      await this.active(tx, a);
      const k = key(
        "operations",
        `IDEMPOTENCY#${a.kind}#${a.id}`,
        `checkout#${attempt}`,
      );
      const previous = await tx.get(k);
      if (previous)
        return previous.abandoned
          ? { state: "abandoned" as const }
          : {
              state: "accepted" as const,
              orderId: previous.result.id as string,
            };
      if (abandon) {
        await tx.put(k, { abandoned: true, createdAt: this.now() });
        return { state: "abandoned" as const };
      }
      return { state: "unknown" as const };
    });
  }
  async outlet() {
    const state = await this.store.get(
      key("core", `OUTLET#${this.config.outletId}`),
    );
    return {
      open: this.config.ordersEnabled && state?.open !== false,
      radiusKm: this.config.radiusKm,
      latitude: this.config.latitude,
      longitude: this.config.longitude,
      pickupAddress: this.config.pickupAddress ?? null,
    };
  }
  async serviceability(a: Actor, input: unknown) {
    const p = z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      })
      .strict()
      .parse(input);
    await atomic(this.store, (tx) => this.active(tx, a));
    const distanceKm = this.distance(p.latitude, p.longitude);
    return {
      deliverable: distanceKm <= this.config.radiusKm,
      distanceKm: Math.round(distanceKm * 100) / 100,
      radiusKm: this.config.radiusKm,
      open: (await this.outlet()).open,
    };
  }
  async riders(a: Actor, cursor?: string) {
    staff(a, ["OWNER", "MANAGER", "OPERATOR"]);
    const page = await this.store.query(
      "core",
      `RIDERS#${this.config.outletId}`,
      "",
      cursor,
    );
    return { ...page, items: page.items.map(publicEntity) };
  }
  async cashCollections(a: Actor, date: string, cursor?: string) {
    staff(a, ["OWNER", "MANAGER", "OPERATOR"]);
    requireThat(
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        Number.isFinite(Date.parse(date)) &&
        new Date(date).toISOString().slice(0, 10) === date,
      "invalid_date",
      400,
    );
    const page = await this.store.query(
      "operations",
      `CASH#${this.config.outletId}#${date}`,
      "",
      cursor,
    );
    return { ...page, items: page.items.map(publicEntity) };
  }
  async deliveryIssue(a: Actor, id: string, input: unknown, attempt: string) {
    staff(a, ["OWNER", "MANAGER", "OPERATOR", "RIDER"]);
    await this.order(a, id);
    const issue = z
      .object({
        reason: z.enum([
          "customer_unreachable",
          "cash_refused",
          "address_problem",
          "other",
        ]),
        note: z.string().trim().min(1).max(300),
      })
      .strict()
      .parse(input);
    return this.execute(
      a,
      "delivery-issue",
      attempt,
      { id, ...issue },
      async (tx) => {
        const o = (await tx.get(okey(id)))!;
        requireThat(
          o.fulfilment === "delivery" &&
            ["ready", "out_for_delivery"].includes(o.status),
          "invalid_transition",
        );
        if (!can(a, ["OWNER", "MANAGER", "OPERATOR"]))
          requireThat(o.riderId === a.id, "forbidden", 403);
        const updated = {
          ...o,
          deliveryIssue: { ...issue, reportedBy: a.id, reportedAt: this.now() },
          updatedAt: this.now(),
        };
        await tx.put(okey(id), updated);
        await this.audit(tx, a, "delivery.issue", id);
        return publicEntity(updated);
      },
    );
  }
  async order(a: Actor, id: string) {
    const o = await this.store.get(okey(id));
    requireThat(o, "not_found", 404);
    if (a.kind === "customer") {
      await atomic(this.store, (tx) => this.active(tx, a));
      requireThat(o.customerId === a.id, "forbidden", 403);
    } else {
      staff(a, ["OWNER", "MANAGER", "OPERATOR", "KITCHEN", "RIDER"]);
      if (
        can(a, ["RIDER"]) &&
        !can(a, ["OWNER", "MANAGER", "OPERATOR", "KITCHEN"])
      )
        requireThat(o.riderId === a.id, "forbidden", 403);
      await atomic(this.store, (tx) => this.activeRider(tx, a));
    }
    const result = publicEntity(o);
    if (
      a.kind === "staff" &&
      can(a, ["KITCHEN"]) &&
      !can(a, ["OWNER", "MANAGER", "OPERATOR", "RIDER"])
    )
      delete result.address;
    return result;
  }
  async listOrders(a: Actor, cursor?: string) {
    if (a.kind === "customer")
      await atomic(this.store, (tx) => this.active(tx, a));
    else staff(a, ["OWNER", "MANAGER", "OPERATOR", "KITCHEN"]);
    const r = await this.store.query(
      "core",
      a.kind === "customer"
        ? `CUSTOMER#${a.id}`
        : `OUTLET#${this.config.outletId}`,
      "ORDER#",
      cursor,
    );
    return {
      items: await Promise.all(r.items.map((x) => this.order(a, x.id))),
      cursor: r.cursor,
    };
  }
  async assign(a: Actor, id: string, riderId: string, idempotency: string) {
    staff(a, ["OWNER", "MANAGER", "OPERATOR"]);
    requireThat(/^[A-Za-z0-9-]{1,100}$/.test(riderId), "invalid_rider", 400);
    return this.execute(
      a,
      "assign",
      idempotency,
      { id, riderId },
      async (tx) => {
        const rider = await tx.get(key("core", `RIDER#${riderId}`));
        requireThat(rider?.active, "rider_not_registered");
        const o = await tx.get(okey(id));
        requireThat(
          o &&
            o.fulfilment === "delivery" &&
            !["delivered", "cancelled", "rejected"].includes(o.status),
          "invalid_order",
        );
        await tx.put(okey(id), { ...o, riderId, updatedAt: this.now() });
        await tx.put(key("core", `RIDER#${riderId}`, `ORDER#${id}`), { id });
        await this.audit(tx, a, "rider.assigned", id);
        return { id, riderId };
      },
    );
  }
  async registerRider(a: Actor, id: string, active: boolean, name?: string) {
    staff(a);
    requireThat(
      /^[A-Za-z0-9-]{1,100}$/.test(id) && typeof active === "boolean",
      "invalid_rider",
      400,
    );
    return atomic(this.store, async (tx) => {
      const previous = await tx.get(key("core", `RIDER#${id}`));
      const entry = {
        id,
        active,
        name: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .parse(name ?? previous?.name ?? id),
      };
      await tx.put(key("core", `RIDER#${id}`), entry);
      await tx.put(key("core", `RIDERS#${this.config.outletId}`, id), entry);
      await this.audit(tx, a, "rider.updated", id);
      return { id, active };
    });
  }
  async riderOrders(a: Actor, cursor?: string) {
    staff(a, ["RIDER"]);
    await atomic(this.store, (tx) => this.activeRider(tx, a));
    const r = await this.store.query("core", `RIDER#${a.id}`, "ORDER#", cursor);
    const orders = [];
    for (const x of r.items) {
      const o = await this.store.get(okey(x.id));
      if (o?.riderId === a.id) orders.push(publicEntity(o));
    }
    return { items: orders, cursor: r.cursor };
  }
  private otpHash(id: string, otp: string) {
    return createHmac("sha256", this.config.otpPepper)
      .update(`${id}:${otp}`)
      .digest("hex");
  }
  async issueOtp(a: Actor, id: string, idempotency: string, reason?: string) {
    staff(a, ["OWNER", "MANAGER", "OPERATOR"]);
    return this.execute(
      a,
      "issue-otp",
      idempotency,
      { id, ...(reason ? { reason } : {}) },
      async (tx) => {
        const o = await tx.get(okey(id));
        requireThat(
          o?.fulfilment === "delivery" &&
            ["ready", "out_for_delivery"].includes(o.status),
          "invalid_transition",
        );
        if (o.status === "out_for_delivery") {
          requireThat(
            reason?.trim() && reason.length <= 300,
            "reason_required",
            400,
          );
          requireThat(
            o.otpExpires <= this.config.now().getTime() || o.otpAttempts >= 5,
            "otp_still_active",
          );
        }
        const otp = String(randomInt(100000, 1000000));
        await tx.put(okey(id), {
          ...o,
          otpHash: this.otpHash(id, otp),
          ...(reason ? { otpResetReason: reason } : {}),
          otpAttempts: 0,
          otpExpires: this.config.now().getTime() + 30 * 60_000,
        });
        await tx.put(
          key("operations", `CUSTOMER#${o.customerId}`, `OTP#${id}`),
          {
            otp,
            orderId: id,
            expiresAt: Math.floor(this.config.now().getTime() / 1000) + 1800,
          },
        );
        await this.audit(tx, a, "delivery.otp-issued", id);
        return { id, issued: true };
      },
    );
  }
  async deliveryOtp(a: Actor, id: string) {
    requireThat(a.kind === "customer", "forbidden", 403);
    const o = await this.order(a, id);
    requireThat(
      !["delivered", "cancelled", "rejected"].includes(o.status),
      "otp_unavailable",
    );
    const r = await this.store.get(
      key("operations", `CUSTOMER#${a.id}`, `OTP#${id}`),
    );
    requireThat(r, "otp_unavailable", 404);
    const privateOrder = await this.store.get(okey(id));
    requireThat(
      r.expiresAt * 1000 > this.config.now().getTime() &&
        privateOrder?.otpAttempts < 5,
      "otp_expired_or_locked",
      422,
    );
    return { otp: r.otp, expiresAt: r.expiresAt };
  }
  async transition(a: Actor, id: string, input: unknown, idempotency: string) {
    const b = schemas.transitionSchema.parse(input);
    // Reauthorize before an idempotency response can be replayed. State checks
    // remain inside the transaction so a valid retry can replay a terminal state.
    await this.order(a, id);
    if (a.kind === "customer")
      requireThat(b.status === "cancelled", "forbidden", 403);
    else {
      staff(a, ["OWNER", "MANAGER", "OPERATOR", "KITCHEN", "RIDER"]);
      if (!can(a, ["OWNER", "MANAGER", "OPERATOR"]))
        requireThat(
          can(a, ["RIDER"])
            ? ["out_for_delivery", "delivered"].includes(b.status)
            : ["preparing", "ready"].includes(b.status),
          "forbidden",
          403,
        );
    }
    const result = await this.execute(
      a,
      "transition",
      idempotency,
      { id, ...b },
      async (tx) => {
        const o = await tx.get(okey(id));
        requireThat(o, "not_found", 404);
        if (a.kind === "customer") {
          requireThat(
            o.customerId === a.id &&
              b.status === "cancelled" &&
              o.status === "placed",
            "forbidden",
            403,
          );
        } else {
          staff(a, ["OWNER", "MANAGER", "OPERATOR", "KITCHEN", "RIDER"]);
          if (!can(a, ["OWNER", "MANAGER", "OPERATOR"])) {
            if (can(a, ["RIDER"]))
              requireThat(
                o.riderId === a.id &&
                  ["out_for_delivery", "delivered"].includes(b.status),
                "forbidden",
                403,
              );
            else
              requireThat(
                ["preparing", "ready"].includes(b.status),
                "forbidden",
                403,
              );
          }
        }
        const transitions: Record<string, string[]> = {
          placed: ["accepted", "rejected", "cancelled"],
          accepted: ["preparing", "cancelled"],
          preparing: ["ready"],
          ready:
            o.fulfilment === "delivery" ? ["out_for_delivery"] : ["delivered"],
          out_for_delivery: ["delivered"],
        };
        requireThat(
          transitions[o.status]?.includes(b.status),
          "invalid_transition",
        );
        if (["rejected", "cancelled"].includes(b.status) && a.kind === "staff")
          requireThat(b.reason, "reason_required", 400);
        if (b.status === "out_for_delivery") {
          requireThat(o.riderId && o.otpHash, "rider_and_otp_required");
          requireThat(
            (await tx.get(key("core", `RIDER#${o.riderId}`)))?.active,
            "rider_not_active",
          );
        }
        if (b.status === "delivered" && o.fulfilment === "delivery") {
          requireThat(
            o.otpHash &&
              o.otpExpires > this.config.now().getTime() &&
              o.otpAttempts < 5,
            "otp_expired_or_locked",
          );
          const hash = this.otpHash(id, b.otp ?? "");
          if (!timingSafeEqual(Buffer.from(o.otpHash), Buffer.from(hash))) {
            await tx.put(okey(id), { ...o, otpAttempts: o.otpAttempts + 1 });
            return { error: "invalid_otp" };
          }
        }
        const updated = {
          ...o,
          status: b.status,
          updatedAt: this.now(),
          ...(b.reason ? { reason: b.reason } : {}),
        };
        if (["cancelled", "rejected"].includes(b.status)) {
          for (const line of o.lines) {
            const k = this.menuKey(line.sku),
              p = (await tx.get(k))!;
            await tx.put(k, { ...p, stock: p.stock + line.quantity });
          }
          if (o.rewardUsedPaise) {
            const c = (await tx.get(ckey(o.customerId)))!;
            await tx.put(ckey(o.customerId), {
              ...c,
              balancePaise: c.balancePaise + o.rewardUsedPaise,
            });
            await tx.put(
              key("ledger", `CUSTOMER#${o.customerId}`, `ORDER#${id}#RESTORE`),
              {
                amountPaise: o.rewardUsedPaise,
                orderId: id,
                type: "cancellation_restore",
                at: this.now(),
              },
            );
          }
        }
        await tx.put(okey(id), updated);
        await tx.put(
          key(
            "core",
            `CUSTOMER#${o.customerId}`,
            `NOTIFICATION#${this.now()}#${identifier()}`,
          ),
          {
            type: "order_status",
            orderId: id,
            status: b.status,
            createdAt: this.now(),
          },
        );
        await this.reward(tx, updated);
        await this.audit(tx, a, `order.${b.status}`, id);
        return publicEntity(updated);
      },
    );
    if ("error" in result) throw new Fault(422, result.error as string);
    return result;
  }
  async collect(
    a: Actor,
    id: string,
    amountPaise: number,
    idempotency: string,
  ) {
    staff(a, ["OWNER", "MANAGER", "OPERATOR", "RIDER"]);
    await this.order(a, id);
    return this.execute(
      a,
      "collect",
      idempotency,
      { id, amountPaise },
      async (tx) => {
        const o = await tx.get(okey(id));
        requireThat(
          o && o.payment === "COD" && o.status === "delivered",
          "invalid_collection",
        );
        if (!can(a, ["OWNER", "MANAGER", "OPERATOR"]))
          requireThat(o.riderId === a.id, "forbidden", 403);
        requireThat(
          o.paymentStatus === "due" &&
            Number.isSafeInteger(amountPaise) &&
            amountPaise === o.totalPaise,
          "invalid_collection_amount",
        );
        const updated = {
          ...o,
          paymentStatus: "collected",
          collectedBy: a.id,
          collectedAt: this.now(),
        };
        await tx.put(okey(id), updated);
        await tx.put(key("ledger", `ORDER#${id}`, "COD_COLLECTION"), {
          amountPaise,
          actorId: a.id,
          at: this.now(),
          type: "cod_collection",
        });
        const date = new Date(this.config.now().getTime() + 330 * 60000)
          .toISOString()
          .slice(0, 10);
        await tx.put(
          key(
            "operations",
            `CASH#${this.config.outletId}#${date}`,
            `${this.now()}#${id}`,
          ),
          {
            orderId: id,
            amountPaise,
            actorId: a.id,
            collectedAt: this.now(),
            fulfilment: o.fulfilment,
          },
        );
        await this.reward(tx, updated);
        await this.audit(tx, a, "cod.collected", id);
        return publicEntity(updated);
      },
    );
  }
  private async reward(tx: Transaction, o: any) {
    if (
      o.status !== "delivered" ||
      o.paymentStatus !== "collected" ||
      o.subtotalPaise <= 9900
    )
      return;
    const c = await tx.get(ckey(o.customerId));
    if (!c?.referrerId || c.firstOrderId !== o.id) return;
    const marker = key(
      "ledger",
      `CUSTOMER#${c.referrerId}`,
      `REFERRAL#${o.customerId}`,
    );
    if (await tx.get(marker)) return;
    const ref = await tx.get(ckey(c.referrerId));
    if (ref?.deletedAt) return;
    await tx.put(marker, {
      amountPaise: 10000,
      orderId: o.id,
      type: "referral_credit",
      at: this.now(),
    });
    await tx.put(ckey(c.referrerId), {
      ...(ref ?? { id: c.referrerId }),
      balancePaise: (ref?.balancePaise ?? 0) + 10000,
    });
  }
  async referralCode(a: Actor) {
    return atomic(this.store, async (tx) => {
      const c = await this.active(tx, a);
      if (c.referralCode) return { code: c.referralCode };
      const code = identifier().replaceAll("-", "").slice(0, 16);
      const k = key("core", `REFERRAL#${code}`);
      requireThat(!(await tx.get(k)), "code_collision");
      await tx.put(k, { customerId: a.id });
      await tx.put(ckey(a.id), { ...c, referralCode: code });
      return { code };
    });
  }
  async attributeReferral(a: Actor, code: string, idempotency: string) {
    return this.execute(a, "referral", idempotency, { code }, async (tx) => {
      const c = await this.active(tx, a),
        ref = await tx.get(key("core", `REFERRAL#${code}`));
      requireThat(ref && ref.customerId !== a.id, "invalid_referral", 400);
      requireThat(!c.firstOrderId && !c.referrerId, "referral_locked");
      const owner = await tx.get(ckey(ref.customerId));
      requireThat(owner && !owner.deletedAt, "invalid_referral", 400);
      await tx.put(ckey(a.id), { ...c, referrerId: ref.customerId });
      return { attributed: true };
    });
  }
  async wallet(a: Actor, cursor?: string) {
    const c = await atomic(this.store, (tx) => this.active(tx, a));
    const r = await this.store.query("ledger", `CUSTOMER#${a.id}`, "", cursor);
    return {
      balancePaise: c.balancePaise ?? 0,
      entries: r.items.map(publicEntity),
      cursor: r.cursor,
    };
  }
  async profile(a: Actor) {
    const c = await atomic(this.store, (tx) => this.active(tx, a));
    return {
      id: a.id,
      name: c.name ?? "",
      preferences: c.preferences ?? { marketing: false },
    };
  }
  async saveProfile(a: Actor, input: unknown) {
    const p = schemas.profileSchema.parse(input);
    return atomic(this.store, async (tx) => {
      const c = await this.active(tx, a);
      await tx.put(ckey(a.id), { ...c, ...p });
      return p;
    });
  }
  async saveAddress(a: Actor, id: string, input: unknown) {
    requireThat(/^[a-zA-Z0-9-]{1,64}$/.test(id), "invalid_address_id", 400);
    const address = schemas.addressSchema.parse(input);
    return atomic(this.store, async (tx) => {
      await this.active(tx, a);
      await tx.put(key("core", `CUSTOMER#${a.id}`, `ADDRESS#${id}`), {
        id,
        ...address,
      });
      return { id, ...address };
    });
  }
  async addresses(a: Actor, cursor?: string) {
    await atomic(this.store, (tx) => this.active(tx, a));
    const r = await this.store.query(
      "core",
      `CUSTOMER#${a.id}`,
      "ADDRESS#",
      cursor,
    );
    return {
      ...r,
      items: r.items.filter((x) => !x.deletedAt).map(publicEntity),
    };
  }
  async deleteAccount(a: Actor, idempotency: string) {
    return this.execute(a, "delete-account", idempotency, {}, async (tx) => {
      const c = await this.active(tx, a);
      await tx.put(ckey(a.id), {
        ...c,
        name: undefined,
        preferences: { marketing: false },
        deletedAt: this.now(),
      });
      await tx.put(
        key("operations", "PRIVACY_REQUESTS", `${this.now()}#${a.id}`),
        {
          customerId: a.id,
          status: "pending-retention-review",
          at: this.now(),
        },
      );
      return { status: "access_disabled", erasure: "pending_retention_review" };
    });
  }
  async enquire(a: Actor, input: unknown, idempotency: string) {
    const b = schemas.bookingSchema.parse(input);
    const start = Date.parse(b.startsAt),
      end = Date.parse(b.endsAt);
    requireThat(
      start > this.config.now().getTime() &&
        end > start &&
        end - start <= 8 * 3600_000,
      "invalid_booking_times",
      400,
    );
    return this.execute(a, "enquiry", idempotency, b, async (tx) => {
      const id = identifier();
      const booking = {
        id,
        customerId: a.id,
        ...b,
        status: "enquiry",
        venueFeePaise: 0,
        minimumFoodOrderPaise: 0,
        cameraFeePaise: 0,
        createdAt: this.now(),
      };
      await tx.put(key("core", `BOOKING#${id}`), booking);
      await tx.put(key("core", `CUSTOMER#${a.id}`, `BOOKING#${id}`), { id });
      await tx.put(
        key("core", `VENUE#${this.config.outletId}`, `BOOKING#${id}`),
        { id },
      );
      return booking;
    });
  }
  async booking(a: Actor, id: string) {
    const b = await this.store.get(key("core", `BOOKING#${id}`));
    requireThat(b, "not_found", 404);
    if (a.kind === "customer") {
      await atomic(this.store, (tx) => this.active(tx, a));
      requireThat(b.customerId === a.id, "forbidden", 403);
    } else staff(a, ["OWNER", "MANAGER", "OPERATOR"]);
    return publicEntity(b);
  }
  private slotKeys(b: any) {
    const start = Date.parse(b.startsAt),
      end = Date.parse(b.endsAt) + this.config.bookingBufferMinutes * 60000;
    const keys = [];
    for (
      let slot = Math.floor(start / 900000);
      slot < Math.ceil(end / 900000);
      slot++
    )
      keys.push(key("core", `VENUE#${this.config.outletId}`, `SLOT#${slot}`));
    return keys;
  }
  async confirmBooking(a: Actor, id: string, idempotency: string) {
    staff(a, ["OWNER", "MANAGER", "OPERATOR"]);
    requireThat(
      this.config.bookingEnabled,
      "booking_policy_not_configured",
      503,
    );
    return this.execute(
      a,
      "booking-confirm",
      idempotency,
      { id },
      async (tx) => {
        const k = key("core", `BOOKING#${id}`),
          b = await tx.get(k);
        requireThat(b?.status === "enquiry", "invalid_booking");
        const start = new Date(b.startsAt),
          end = new Date(b.endsAt);
        requireThat(
          start.getTime() > this.config.now().getTime() &&
            end.getTime() - start.getTime() <=
              this.config.bookingMaxMinutes * 60000 &&
            start.toISOString().slice(0, 10) ===
              end.toISOString().slice(0, 10) &&
            start.getUTCHours() >= this.config.openingUtcHour &&
            end.getUTCHours() + end.getUTCMinutes() / 60 <=
              this.config.closingUtcHour,
          "outside_booking_policy",
          422,
        );
        requireThat(
          start.getTime() % 900000 === 0 && end.getTime() % 900000 === 0,
          "booking_requires_15_minute_boundaries",
          400,
        );
        for (const slot of this.slotKeys(b)) {
          const occupied = await tx.get(slot);
          requireThat(
            !occupied || occupied.status === "released",
            "booking_overlap",
          );
          await tx.put(slot, { bookingId: id, status: "reserved" });
        }
        await tx.put(k, {
          ...b,
          status: "confirmed",
          confirmedBy: a.id,
          confirmedAt: this.now(),
        });
        await this.audit(tx, a, "booking.confirmed", id);
        return { id, status: "confirmed" };
      },
    );
  }
  async cancelBooking(a: Actor, id: string, idempotency: string) {
    staff(a, ["OWNER", "MANAGER", "OPERATOR"]);
    return this.execute(
      a,
      "booking-cancel",
      idempotency,
      { id },
      async (tx) => {
        const k = key("core", `BOOKING#${id}`),
          b = await tx.get(k);
        requireThat(
          b && ["enquiry", "confirmed"].includes(b.status),
          "invalid_booking",
        );
        if (b.status === "confirmed")
          for (const slot of this.slotKeys(b)) {
            const s = await tx.get(slot);
            requireThat(
              s?.bookingId === id && s.status === "reserved",
              "slot_integrity",
            );
            await tx.put(slot, { bookingId: id, status: "released" });
          }
        await tx.put(k, { ...b, status: "cancelled", cancelledAt: this.now() });
        await this.audit(tx, a, "booking.cancelled", id);
        return { id, status: "cancelled" };
      },
    );
  }
  async listBookings(a: Actor, cursor?: string) {
    if (a.kind === "customer")
      await atomic(this.store, (tx) => this.active(tx, a));
    else staff(a, ["OWNER", "MANAGER", "OPERATOR"]);
    const r = await this.store.query(
      "core",
      a.kind === "customer"
        ? `CUSTOMER#${a.id}`
        : `VENUE#${this.config.outletId}`,
      "BOOKING#",
      cursor,
    );
    return {
      items: await Promise.all(r.items.map((x) => this.booking(a, x.id))),
      cursor: r.cursor,
    };
  }
  async photoDelivery(
    a: Actor,
    id: string,
    reference: string,
    idempotency: string,
  ) {
    staff(a, ["OWNER", "MANAGER", "OPERATOR"]);
    requireThat(
      reference.length > 0 && reference.length <= 300,
      "invalid_reference",
      400,
    );
    return this.execute(
      a,
      "photo-record",
      idempotency,
      { id, reference },
      async (tx) => {
        const k = key("core", `BOOKING#${id}`),
          b = await tx.get(k);
        requireThat(
          b?.status === "confirmed" &&
            b.photoConsent &&
            b.photoChannel !== "none",
          "photo_consent_required",
        );
        requireThat(
          Date.parse(b.endsAt) <= this.config.now().getTime(),
          "event_not_finished",
        );
        await tx.put(k, {
          ...b,
          photosSharedAt: this.now(),
          photosSharedBy: a.id,
          photoDeliveryReference: reference,
        });
        await this.audit(tx, a, "photos.delivery-recorded", id);
        return { id, recorded: true };
      },
    );
  }
  async ticket(a: Actor, input: unknown, idempotency: string) {
    const b = schemas.ticketSchema.parse(input);
    return this.execute(a, "support", idempotency, b, async (tx) => {
      if (b.orderId) {
        const o = await tx.get(okey(b.orderId));
        requireThat(o?.customerId === a.id, "forbidden", 403);
      }
      const id = identifier();
      await tx.put(key("operations", "SUPPORT", `${this.now()}#${id}`), {
        id,
        customerId: a.id,
        ...b,
        status: "open",
      });
      return { id, status: "open" };
    });
  }
  async deleteAddress(a: Actor, id: string, idempotency: string) {
    return this.execute(
      a,
      "address-delete",
      idempotency,
      { id },
      async (tx) => {
        const k = key("core", `CUSTOMER#${a.id}`, `ADDRESS#${id}`);
        requireThat(await tx.get(k), "not_found", 404);
        await tx.put(k, { id, deletedAt: this.now() });
        return { deleted: true };
      },
    );
  }
  async notifications(a: Actor, cursor?: string) {
    await atomic(this.store, (tx) => this.active(tx, a));
    const r = await this.store.query(
      "core",
      `CUSTOMER#${a.id}`,
      "NOTIFICATION#",
      cursor,
    );
    return { ...r, items: r.items.map(publicEntity) };
  }
  async reorder(a: Actor, id: string) {
    const o = await this.order(a, id);
    requireThat(a.kind === "customer", "customer_required", 403);
    const basket = {
      lines: o.lines.map((l: any) => ({
        sku: l.sku,
        quantity: l.quantity,
        addons: l.addons,
        instructions: l.instructions,
      })),
      fulfilment: o.fulfilment,
      useRewards: false,
      ...(o.address ? { address: o.address } : {}),
    };
    return { basket, pricing: await this.basket(a, basket) };
  }
  venue() {
    return {
      outletId: this.config.outletId,
      location: "first floor",
      capacity: 20,
      venueFeePaise: 0,
      minimumFoodOrderPaise: 0,
      cameraFeePaise: 0,
      occasions: ["birthday", "farewell", "office", "casual"],
      decoration: { status: "confirm_introductory_offer_with_staff" },
      cameraAssistance: { status: "request_subject_to_confirmation" },
      photoDelivery: {
        channels: ["email", "whatsapp"],
        method: "manual_staff_delivery",
        requiresConsent: true,
      },
      enquiryIsReservation: false,
      confirmationEnabled: this.config.bookingEnabled,
    };
  }

  async operations(a: Actor, kind: string, cursor?: string) {
    staff(a);
    requireThat(
      ["SUPPORT", "PRIVACY_REQUESTS"].includes(kind) ||
        /^AUDIT#\d{4}-\d{2}-\d{2}$/.test(kind),
      "invalid_operation_query",
      400,
    );
    const r = await this.store.query("operations", kind, "", cursor);
    return { ...r, items: r.items.map(publicEntity) };
  }
}
