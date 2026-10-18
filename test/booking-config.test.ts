import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimeConfig } from "../src/config.js";
const base = {
  ENVIRONMENT_NAME: "brekmate-staging",
  CORE_TABLE: "core",
  LEDGER_TABLE: "ledger",
  OPERATIONS_TABLE: "operations",
  CUSTOMER_ISSUER: "https://cognito-idp.ap-south-1.amazonaws.com/customer",
  STAFF_ISSUER: "https://cognito-idp.ap-south-1.amazonaws.com/staff",
  CUSTOMER_CLIENT_ID: "customer",
  STAFF_CLIENT_ID: "staff",
  OUTLET_LATITUDE: "28.45",
  OUTLET_LONGITUDE: "77.02",
  OTP_SECRET_ARN:
    "arn:aws:secretsmanager:ap-south-1:123456789012:secret:fixture",
};
const policy = {
  BOOKING_MAX_MINUTES: "120",
  BOOKING_BUFFER_MINUTES: "0",
  BOOKING_OPEN_UTC_HOUR: "4",
  BOOKING_CLOSE_UTC_HOUR: "14",
};
for (const name of Object.keys(policy))
  test("booking confirmation cannot use an implicit " + name, () => {
    const env: Record<string, string> = {
      ...base,
      ...policy,
      BOOKING_ENABLED: "true",
    };
    delete env[name];
    assert.throws(() => runtimeConfig(env), /explicit booking policy/i);
  });
test("disabled booking confirmation needs no schedule and leaves enquiries available", () => {
  assert.equal(runtimeConfig(base).config.bookingEnabled, false);
});
test("explicit fixture booking policy can be configured without enabling orders", () => {
  const c = runtimeConfig({
    ...base,
    ...policy,
    BOOKING_ENABLED: "true",
  }).config;
  assert.equal(c.bookingEnabled, true);
  assert.equal(c.ordersEnabled, false);
  assert.equal(c.bookingBufferMinutes, 0);
});
