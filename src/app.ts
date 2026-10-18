import Fastify, { type FastifyRequest } from "fastify";
import { ZodError, z } from "zod";
import { Fault } from "./errors.js";
import { Service, type Actor } from "./service.js";
import type { Authenticator } from "./auth.js";
export function createApp(service: Service, auth: Authenticator) {
  const app = Fastify({
    logger: {
      level: "info",
      redact: ["req.headers.authorization", "req.body", "res.body"],
      serializers: {
        req: (r) => ({ method: r.method, url: r.url.split("?")[0] }),
        res: (r) => ({ statusCode: r.statusCode }),
      },
    },
    disableRequestLogging: true,
    bodyLimit: 16384,
    requestTimeout: 15000,
    trustProxy: false,
  });
  const contractRoutes: { method: string; url: string }[] = [];
  app.addHook("onRoute", (options) => {
    for (const method of [options.method].flat())
      if (method !== "HEAD") contractRoutes.push({ method, url: options.url });
  });
  const actors = new WeakMap<FastifyRequest, Actor>();
  const actor = (r: FastifyRequest) => actors.get(r)!;
  const id = (r: FastifyRequest) =>
    z.object({ id: z.string().min(1).max(100) }).parse(r.params).id;
  const idem = (r: FastifyRequest) =>
    z.string().parse(r.headers["idempotency-key"]);
  const cursor = (r: FastifyRequest) =>
    z.object({ cursor: z.string().max(250).optional() }).parse(r.query).cursor;
  app.addHook("onRequest", async (r, reply) => {
    reply
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff");
    if (r.routeOptions.url !== "/health")
      actors.set(r, await auth.authenticate(r.headers.authorization));
  });
  app.setErrorHandler((e: any, r, reply) => {
    const status =
      e instanceof Fault
        ? e.status
        : e instanceof ZodError
          ? 400
          : e.statusCode >= 400 && e.statusCode < 500
            ? e.statusCode
            : 500;
    const code =
      e instanceof Fault
        ? e.code
        : e instanceof ZodError
          ? "invalid_request"
          : status === 500
            ? "internal_error"
            : "invalid_request";
    if (status === 500)
      app.log.error({ requestId: r.id, errorName: e.name }, "request failed");
    reply.code(status).send({ error: code, requestId: r.id });
  });
  app.get("/health", async () => ({
    status: "ok",
    service: "brekmate-be",
    version: "0.1.0",
  }));
  app.get("/v1/venue", async () => service.venue());
  app.get("/v1/outlet", async () => service.outlet());
  app.post("/v1/serviceability", async (r) =>
    service.serviceability(actor(r), r.body),
  );
  app.post("/v1/checkouts/reconcile", async (r) => {
    const b = z
      .object({ key: z.string(), abandon: z.boolean().default(false) })
      .strict()
      .parse(r.body);
    return service.reconcileCheckout(actor(r), b.key, b.abandon);
  });
  app.get("/v1/staff/riders", async (r) => service.riders(actor(r), cursor(r)));
  app.get("/v1/staff/cash/:id", async (r) =>
    service.cashCollections(actor(r), id(r), cursor(r)),
  );
  app.post("/v1/orders/:id/delivery-issues", async (r) =>
    service.deliveryIssue(actor(r), id(r), r.body, idem(r)),
  );
  app.get("/v1/notifications", async (r) =>
    service.notifications(actor(r), cursor(r)),
  );
  app.post("/v1/orders/:id/reorder", async (r) =>
    service.reorder(actor(r), id(r)),
  );
  app.delete("/v1/addresses/:id", async (r) =>
    service.deleteAddress(actor(r), id(r), idem(r)),
  );
  app.get("/v1/menu", async (r) => service.menuPage(cursor(r)));
  app.post("/v1/quotes", async (r) => service.basket(actor(r), r.body));
  app.post("/v1/orders", async (r, reply) =>
    reply.code(201).send(await service.checkout(actor(r), r.body, idem(r))),
  );
  app.get("/v1/orders", async (r) => service.listOrders(actor(r), cursor(r)));
  app.get("/v1/orders/:id", async (r) => service.order(actor(r), id(r)));
  app.post("/v1/orders/:id/status", async (r) =>
    service.transition(actor(r), id(r), r.body, idem(r)),
  );
  app.post("/v1/orders/:id/assignment", async (r) => {
    const b = z.object({ riderId: z.string() }).strict().parse(r.body);
    return service.assign(actor(r), id(r), b.riderId, idem(r));
  });
  app.post("/v1/orders/:id/collection", async (r) => {
    const b = z
      .object({ amountPaise: z.number().int().nonnegative() })
      .strict()
      .parse(r.body);
    return service.collect(actor(r), id(r), b.amountPaise, idem(r));
  });
  app.post("/v1/orders/:id/otp", async (r) => {
    const b = z
      .object({ reason: z.string().trim().min(1).max(300).optional() })
      .strict()
      .parse(r.body ?? {});
    return service.issueOtp(actor(r), id(r), idem(r), b.reason);
  });
  app.get("/v1/orders/:id/otp", async (r) =>
    service.deliveryOtp(actor(r), id(r)),
  );
  app.get("/v1/rider/orders", async (r) =>
    service.riderOrders(actor(r), cursor(r)),
  );
  app.put("/v1/staff/riders/:id", async (r) => {
    const b = z
      .object({
        active: z.boolean(),
        name: z.string().trim().min(1).max(100).optional(),
      })
      .strict()
      .parse(r.body);
    return service.registerRider(actor(r), id(r), b.active, b.name);
  });
  app.put("/v1/staff/products", async (r) =>
    service.saveProduct(actor(r), r.body),
  );
  app.put("/v1/staff/outlet", async (r) => {
    const b = z.object({ open: z.boolean() }).strict().parse(r.body);
    return service.setOpen(actor(r), b.open);
  });
  app.get("/v1/profile", async (r) => service.profile(actor(r)));
  app.put("/v1/profile", async (r) => service.saveProfile(actor(r), r.body));
  app.delete("/v1/profile", async (r) =>
    service.deleteAccount(actor(r), idem(r)),
  );
  app.get("/v1/addresses", async (r) => service.addresses(actor(r), cursor(r)));
  app.put("/v1/addresses/:id", async (r) =>
    service.saveAddress(actor(r), id(r), r.body),
  );
  app.get("/v1/wallet", async (r) => service.wallet(actor(r), cursor(r)));
  app.post("/v1/referral-code", async (r) => service.referralCode(actor(r)));
  app.post("/v1/referrals", async (r) => {
    const b = z
      .object({ code: z.string().regex(/^[a-f0-9]{16}$/) })
      .strict()
      .parse(r.body);
    return service.attributeReferral(actor(r), b.code, idem(r));
  });
  app.post("/v1/bookings", async (r, reply) =>
    reply.code(201).send(await service.enquire(actor(r), r.body, idem(r))),
  );
  app.get("/v1/bookings", async (r) =>
    service.listBookings(actor(r), cursor(r)),
  );
  app.get("/v1/bookings/:id", async (r) => service.booking(actor(r), id(r)));
  app.post("/v1/bookings/:id/confirmation", async (r) =>
    service.confirmBooking(actor(r), id(r), idem(r)),
  );
  app.post("/v1/bookings/:id/cancellation", async (r) =>
    service.cancelBooking(actor(r), id(r), idem(r)),
  );
  app.post("/v1/bookings/:id/photo-delivery", async (r) => {
    const b = z.object({ reference: z.string() }).strict().parse(r.body);
    return service.photoDelivery(actor(r), id(r), b.reference, idem(r));
  });
  app.post("/v1/support", async (r, reply) =>
    reply.code(201).send(await service.ticket(actor(r), r.body, idem(r))),
  );
  app.get("/v1/staff/operations/:id", async (r) =>
    service.operations(actor(r), id(r), cursor(r)),
  );
  return Object.assign(app, { contractRoutes });
}
