import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { createApp } from "../src/app.js";
import { Service } from "../src/service.js";
import { MemoryStore } from "../src/store.js";
import { Fault } from "../src/errors.js";
import * as schema from "../src/schemas.js";
const app = createApp(new Service(new MemoryStore(), {} as any), {
  async authenticate() {
    throw new Fault(401, "not_configured");
  },
});
await app.ready();
const paths: Record<string, any> = {};
const routes: Record<string, string> = {};
const schemaNames: Record<string, string> = {
  "POST /v1/orders": "checkoutSchema",
  "POST /v1/quotes": "basketSchema",
  "PUT /v1/staff/products": "productSchema",
  "PUT /v1/profile": "profileSchema",
  "PUT /v1/addresses/:id": "addressSchema",
  "POST /v1/bookings": "bookingSchema",
  "POST /v1/support": "ticketSchema",
  "POST /v1/orders/:id/status": "transitionSchema",
};
const extraSchemas: Record<string, any> = {
  "POST /v1/checkouts/reconcile": z
    .object({
      key: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
      abandon: z.boolean().default(false),
    })
    .strict(),
  "POST /v1/serviceability": z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    })
    .strict(),
  "POST /v1/orders/:id/delivery-issues": z
    .object({
      reason: z.enum([
        "customer_unreachable",
        "cash_refused",
        "address_problem",
        "other",
      ]),
      note: z.string().trim().min(1).max(300),
    })
    .strict(),
  "POST /v1/orders/:id/otp": z
    .object({ reason: z.string().trim().min(1).max(300).optional() })
    .strict(),

  "POST /v1/orders/:id/assignment": z.object({ riderId: z.string() }).strict(),
  "POST /v1/orders/:id/collection": z
    .object({ amountPaise: z.number().int().nonnegative() })
    .strict(),
  "PUT /v1/staff/riders/:id": z
    .object({
      active: z.boolean(),
      name: z.string().trim().min(1).max(100).optional(),
    })
    .strict(),
  "PUT /v1/staff/outlet": z.object({ open: z.boolean() }).strict(),
  "POST /v1/referrals": z
    .object({ code: z.string().regex(/^[a-f0-9]{16}$/) })
    .strict(),
  "POST /v1/bookings/:id/photo-delivery": z
    .object({ reference: z.string() })
    .strict(),
};
for (const { method, url } of app.contractRoutes) {
  const path = url.replace(/:id/g, "{id}");
  const route = `${method} ${url}`;
  const body = (schema as any)[schemaNames[route] ?? ""] ?? extraSchemas[route];
  const publicRoute = url === "/health";
  const operation: any = {
    operationId: method.toLowerCase() + "_" + url.replace(/[^a-zA-Z0-9]/g, "_"),
    security: publicRoute ? [] : [{ bearerAuth: [] }],
    parameters: [],
    responses: {
      [method === "POST" &&
      ["/v1/orders", "/v1/bookings", "/v1/support"].includes(url)
        ? "201"
        : "200"]: {
        description: "Success; see API.md and source service return types.",
      },
      "400": { description: "Invalid request" },
      "401": { description: "Missing or invalid Cognito access token" },
      "403": { description: "Insufficient role or resource ownership" },
      "409": { description: "State or concurrency conflict" },
      "422": { description: "Not serviceable or failed OTP verification" },
      "503": { description: "Ordering, bookings or payment provider disabled" },
    },
  };
  if (url.includes(":id"))
    operation.parameters.push({
      name: "id",
      in: "path",
      required: true,
      schema: { type: "string", maxLength: 100 },
    });
  if (
    ["POST", "DELETE"].includes(method) &&
    ![
      "/v1/referral-code",
      "/v1/orders/:id/reorder",
      "/v1/quotes",
      "/v1/serviceability",
      "/v1/checkouts/reconcile",
    ].includes(url)
  )
    operation.parameters.push({
      name: "Idempotency-Key",
      in: "header",
      required: true,
      schema: { type: "string", pattern: "^[A-Za-z0-9_-]{8,128}$" },
    });
  if (
    method === "GET" &&
    !url.includes(":id") &&
    !["/health", "/v1/profile", "/v1/venue"].includes(url)
  )
    operation.parameters.push({
      name: "cursor",
      in: "query",
      schema: { type: "string", maxLength: 250 },
    });
  if (body)
    operation.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: z.toJSONSchema(body, { unrepresentable: "any" }),
        },
      },
    };
  (paths[path] ??= {})[method.toLowerCase()] = operation;
  // Shared routes use application-level JWT verification because one API Gateway
  // JWT authorizer cannot simultaneously trust two distinct Cognito issuers.
  const staffOnly =
    url.startsWith("/v1/staff/") ||
    url.startsWith("/v1/rider/") ||
    url.endsWith("/assignment") ||
    url.endsWith("/collection") ||
    url.endsWith("/delivery-issues") ||
    url.endsWith("/confirmation") ||
    url.endsWith("/cancellation") ||
    url.endsWith("/photo-delivery") ||
    (url.endsWith("/otp") && method === "POST");
  const shared =
    [
      "/v1/outlet",
      "/v1/orders",
      "/v1/orders/:id",
      "/v1/orders/:id/status",
      "/v1/bookings",
      "/v1/bookings/:id",
    ].includes(url) &&
    !(url === "/v1/orders" && method === "POST") &&
    !(url === "/v1/bookings" && method === "POST");
  routes[`${method} ${path}`] =
    publicRoute || shared ? "public" : staffOnly ? "staff" : "customer";
}
mkdirSync("integration", { recursive: true });
mkdirSync("docs", { recursive: true });
writeFileSync(
  "docs/openapi.json",
  JSON.stringify(
    {
      openapi: "3.1.0",
      info: {
        title: "BrekMate backend",
        version: "0.1.0",
        description:
          "Implemented core API. Live payments and refunds are not implemented. Response schemas require further stabilization; source return types are authoritative for this version.",
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "Cognito access JWT",
          },
        },
      },
      paths,
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  "integration/api-routes.tfvars.json",
  JSON.stringify({ api_routes: routes }, null, 2) + "\n",
);
await app.close();
console.log(`Generated ${app.contractRoutes.length} routes.`);
