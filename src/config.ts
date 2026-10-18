import { z } from "zod";
import type { Config } from "./service.js";
const envSchema = z.object({
  ENVIRONMENT_NAME: z.string().regex(/^brekmate-(staging|production)$/),
  CORE_TABLE: z.string().min(1),
  LEDGER_TABLE: z.string().min(1),
  OPERATIONS_TABLE: z.string().min(1),
  CUSTOMER_ISSUER: z.url(),
  STAFF_ISSUER: z.url(),
  CUSTOMER_CLIENT_ID: z.string().min(1),
  STAFF_CLIENT_ID: z.string().min(1),
  OUTLET_LATITUDE: z.coerce.number().min(-90).max(90),
  OUTLET_LONGITUDE: z.coerce.number().min(-180).max(180),
  PICKUP_ADDRESS: z.string().trim().min(1).max(300).optional(),
  DELIVERY_RADIUS_KM: z.coerce.number().min(2).max(3).default(3),
  OTP_SECRET_ARN: z
    .string()
    .regex(
      /^arn:aws:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[A-Za-z0-9_./+=@-]+$/,
    ),
  ORDERS_ENABLED: z.enum(["true", "false"]).default("false"),
  ZERO_TAX_POLICY_APPROVED: z.enum(["true", "false"]).default("false"),
  REWARD_ROUNDING_POLICY_APPROVED: z.enum(["true", "false"]).default("false"),
  FIRST_ORDER_POLICY_APPROVED: z.enum(["true", "false"]).default("false"),
  BOOKING_ENABLED: z.enum(["true", "false"]).default("false"),
  BOOKING_MAX_MINUTES: z.coerce.number().int().min(15).max(480).default(180),
  BOOKING_BUFFER_MINUTES: z.coerce.number().int().min(0).max(120).default(15),
  BOOKING_OPEN_UTC_HOUR: z.coerce.number().int().min(0).max(23).default(0),
  BOOKING_CLOSE_UTC_HOUR: z.coerce.number().int().min(1).max(24).default(24),
});
export function runtimeConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.AUTH_MODE || env.STORE_MODE || env.NODE_ENV === "test")
    throw new Error("Local/test overrides are forbidden in Lambda");
  const v = envSchema.parse(env);
  if (
    v.BOOKING_ENABLED === "true" &&
    [
      "BOOKING_MAX_MINUTES",
      "BOOKING_BUFFER_MINUTES",
      "BOOKING_OPEN_UTC_HOUR",
      "BOOKING_CLOSE_UTC_HOUR",
    ].some((name) => !env[name]?.trim())
  )
    throw new Error(
      "Explicit booking policy settings are required before confirmation",
    );
  if (
    v.ORDERS_ENABLED === "true" &&
    [
      v.ZERO_TAX_POLICY_APPROVED,
      v.REWARD_ROUNDING_POLICY_APPROVED,
      v.FIRST_ORDER_POLICY_APPROVED,
    ].some((x) => x !== "true")
  )
    throw new Error("Order policies require explicit review before enabling");
  if (v.BOOKING_CLOSE_UTC_HOUR <= v.BOOKING_OPEN_UTC_HOUR)
    throw new Error("Invalid booking hours");
  const config: Config = {
    outletId: "main",
    latitude: v.OUTLET_LATITUDE,
    longitude: v.OUTLET_LONGITUDE,
    pickupAddress: v.PICKUP_ADDRESS,
    radiusKm: v.DELIVERY_RADIUS_KM,
    ordersEnabled: v.ORDERS_ENABLED === "true",
    bookingEnabled: v.BOOKING_ENABLED === "true",
    bookingMaxMinutes: v.BOOKING_MAX_MINUTES,
    bookingBufferMinutes: v.BOOKING_BUFFER_MINUTES,
    openingUtcHour: v.BOOKING_OPEN_UTC_HOUR,
    closingUtcHour: v.BOOKING_CLOSE_UTC_HOUR,
    otpPepper: "",
    now: () => new Date(),
  };
  return { values: v, config };
}
