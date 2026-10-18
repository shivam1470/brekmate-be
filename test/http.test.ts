import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { Fault } from "../src/errors.js";
import { MemoryStore } from "../src/store.js";
import { Service } from "../src/service.js";
import { customer, manager, fixtureConfig, seed } from "./fixtures.js";
const app = () => {
  const service = new Service(new MemoryStore(), fixtureConfig);
  return {
    service,
    api: createApp(service, {
      async authenticate(h) {
        if (h === "Bearer customer") return customer;
        if (h === "Bearer other") return { ...customer, id: "other" };
        if (h === "Bearer manager") return manager;
        throw new Fault(401, "invalid_token");
      },
    }),
  };
};
const body = {
  lines: [{ sku: "meal", quantity: 1, addons: [] }],
  fulfilment: "pickup",
  useRewards: false,
  payment: "COD",
};
test("health is public, all customer data requires authentication", async (t) => {
  const { api } = app();
  t.after(() => api.close());
  assert.equal((await api.inject({ url: "/health" })).statusCode, 200);
  for (const url of [
    "/v1/menu",
    "/v1/profile",
    "/v1/orders",
    "/v1/wallet",
    "/v1/bookings",
  ])
    assert.equal((await api.inject({ url })).statusCode, 401);
});
test("HTTP checkout, strict schemas, ownership, replay, staff transitions", async (t) => {
  const { api, service } = app();
  t.after(() => api.close());
  await seed(service);
  const h = {
    authorization: "Bearer customer",
    "idempotency-key": "http-checkout-key",
  };
  const malformed = await api.inject({
    method: "POST",
    url: "/v1/orders",
    headers: h,
    payload: { ...body, totalPaise: 1 },
  });
  assert.equal(malformed.statusCode, 400);
  const first = await api.inject({
    method: "POST",
    url: "/v1/orders",
    headers: h,
    payload: {
      ...body,
      quoteToken: (await service.basket(customer, body)).quoteToken,
    },
  });
  assert.equal(first.statusCode, 201);
  const id = first.json().id;
  assert.equal(first.json().totalPaise, 12000);
  const second = await api.inject({
    method: "POST",
    url: "/v1/orders",
    headers: h,
    payload: {
      ...body,
      quoteToken: (await service.basket(customer, body)).quoteToken,
    },
  });
  assert.equal(second.json().id, id);
  assert.equal(
    (
      await api.inject({
        url: `/v1/orders/${id}`,
        headers: { authorization: "Bearer other" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await api.inject({
        method: "POST",
        url: `/v1/orders/${id}/status`,
        headers: { ...h, "idempotency-key": "accept-order-key" },
        payload: { status: "accepted" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await api.inject({
        method: "POST",
        url: `/v1/orders/${id}/status`,
        headers: {
          authorization: "Bearer manager",
          "idempotency-key": "accept-order-key",
        },
        payload: { status: "accepted" },
      })
    ).statusCode,
    200,
  );
});
test("HTTP rejects missing idempotency, content type, oversize payload", async (t) => {
  const { api, service } = app();
  t.after(() => api.close());
  await seed(service);
  assert.equal(
    (
      await api.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { authorization: "Bearer customer" },
        payload: {
          ...body,
          quoteToken: (await service.basket(customer, body)).quoteToken,
        },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await api.inject({
        method: "POST",
        url: "/v1/orders",
        headers: {
          authorization: "Bearer customer",
          "content-type": "text/plain",
        },
        payload: "bad",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await api.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { authorization: "Bearer customer" },
        payload: { extra: "a".repeat(17000) },
      })
    ).statusCode,
    413,
  );
});
test("HTTP does not expose stack traces, OTP hashes, cacheable responses", async (t) => {
  const { api, service } = app();
  t.after(() => api.close());
  await seed(service);
  const r = await api.inject({
    method: "POST",
    url: "/v1/orders",
    headers: {
      authorization: "Bearer customer",
      "idempotency-key": "response-checkout",
    },
    payload: {
      ...body,
      quoteToken: (await service.basket(customer, body)).quoteToken,
    },
  });
  assert.equal(r.headers["cache-control"], "no-store");
  assert.equal(r.json().otpHash, undefined);
  const invalid = await api.inject({
    url: "/v1/orders/no-such-order",
    headers: { authorization: "Bearer customer" },
  });
  assert.equal(invalid.statusCode, 404);
  assert.equal(invalid.json().stack, undefined);
});

test("HTTP profile, address, support and booking customer/staff journey", async (t) => {
  const { api } = app();
  t.after(() => api.close());
  const customerHeaders = {
    authorization: "Bearer customer",
    "idempotency-key": "journey-customer-001",
  };
  const staffHeaders = {
    authorization: "Bearer manager",
    "idempotency-key": "journey-staff-001",
  };
  const request = async (
    method: any,
    url: string,
    payload?: unknown,
    headers = customerHeaders,
  ) => {
    const r = await api.inject({
      method,
      url,
      headers,
      ...(payload ? { payload } : {}),
    });
    assert(r.statusCode < 300, `${method} ${url}: ${r.body}`);
    return r.json();
  };
  await request("PUT", "/v1/profile", {
    name: "Fixture Customer",
    preferences: { marketing: false },
  });
  assert.equal((await request("GET", "/v1/profile")).name, "Fixture Customer");
  await request("PUT", "/v1/addresses/home", {
    line: "Fixture address",
    latitude: 28.45,
    longitude: 77.02,
  });
  assert.equal((await request("GET", "/v1/addresses")).items.length, 1);
  await request("DELETE", "/v1/addresses/home");
  assert.equal((await request("GET", "/v1/addresses")).items.length, 0);
  assert.equal((await request("GET", "/v1/venue")).minimumFoodOrderPaise, 0);
  assert.equal((await request("GET", "/v1/wallet")).balancePaise, 0);
  assert((await request("POST", "/v1/referral-code")).code);
  await request("POST", "/v1/support", {
    subject: "Test request",
    message: "Synthetic fixture only",
  });
  assert.equal(
    (
      await request(
        "GET",
        "/v1/staff/operations/SUPPORT",
        undefined,
        staffHeaders,
      )
    ).items.length,
    1,
  );
  const b = await request("POST", "/v1/bookings", {
    occasion: "birthday",
    guests: 15,
    startsAt: "2030-01-01T12:00:00Z",
    endsAt: "2030-01-01T13:00:00Z",
    photoChannel: "none",
    photoConsent: false,
  });
  await request("POST", `/v1/bookings/${b.id}/confirmation`, {}, staffHeaders);
  assert.equal(
    (await request("GET", `/v1/bookings/${b.id}`)).status,
    "confirmed",
  );
  assert.equal((await request("GET", "/v1/bookings")).items.length, 1);
  await request("POST", `/v1/bookings/${b.id}/cancellation`, {}, staffHeaders);
  assert.equal((await request("GET", "/v1/notifications")).items.length, 0);
  const deletion = await request("DELETE", "/v1/profile");
  assert.equal(deletion.status, "access_disabled");
  assert.equal(
    (await api.inject({ url: "/v1/profile", headers: customerHeaders }))
      .statusCode,
    403,
  );
});
