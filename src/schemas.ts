import { z } from "zod";
const text = (n = 120) => z.string().trim().min(1).max(n);
export const sku = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const amount = z.number().int().min(0).max(100_000_000);
export const addressSchema = z
  .object({
    line: text(300),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    recipientName: text(100).optional(),
    phone: z
      .string()
      .regex(/^\+[1-9][0-9]{7,14}$/)
      .optional(),
    floor: z.string().trim().max(80).optional(),
    landmark: z.string().trim().max(120).optional(),
  })
  .strict();
export const basketSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            sku,
            quantity: z.number().int().min(1).max(20),
            addons: z.array(sku).max(10).default([]),
            instructions: z.string().max(300).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    fulfilment: z.enum(["delivery", "pickup"]),
    useRewards: z.boolean(),
    address: addressSchema.optional(),
  })
  .strict();
export const checkoutSchema = basketSchema
  .extend({
    payment: z.enum(["COD", "ONLINE"]),
    quoteToken: z.string().max(300).optional(),
  })
  .strict();
export const productSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative().optional(),
    sku,
    name: text(),
    category: text(64),
    pricePaise: amount,
    stock: z.number().int().min(0).max(100000),
    available: z.boolean(),
    vegetarian: z.literal(true),
    addons: z.record(sku, amount).default({}),
  })
  .strict();
export const profileSchema = z
  .object({
    name: text(100),
    preferences: z.object({ marketing: z.boolean() }).strict(),
  })
  .strict();
export const bookingSchema = z
  .object({
    occasion: z.enum(["birthday", "farewell", "office", "casual"]),
    guests: z.number().int().min(1).max(20),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    theme: z.string().max(100).default(""),
    cameraAssistanceRequested: z.boolean().default(false),
    photoChannel: z.enum(["email", "whatsapp", "none"]),
    photoContact: z.string().max(120).optional(),
    photoConsent: z.boolean(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.photoChannel !== "none" && (!v.photoConsent || !v.photoContact))
      c.addIssue({ code: "custom", message: "contact and consent required" });
    if (
      v.photoChannel === "email" &&
      !z.email().safeParse(v.photoContact).success
    )
      c.addIssue({ code: "custom", message: "invalid email" });
    if (
      v.photoChannel === "whatsapp" &&
      !/^\+[1-9][0-9]{7,14}$/.test(v.photoContact ?? "")
    )
      c.addIssue({ code: "custom", message: "invalid phone" });
  });
export const ticketSchema = z
  .object({
    subject: text(150),
    message: text(2000),
    orderId: z.uuid().optional(),
  })
  .strict();
export const transitionSchema = z
  .object({
    status: z.enum([
      "accepted",
      "rejected",
      "preparing",
      "ready",
      "out_for_delivery",
      "delivered",
      "cancelled",
    ]),
    reason: z.string().trim().min(1).max(300).optional(),
    otp: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .strict();
