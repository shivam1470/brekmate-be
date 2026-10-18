// Separate local-only entry point. This module is excluded from the Lambda bundle.
import { createApp } from "./app.js";
import { MemoryStore } from "./store.js";
import { Service } from "./service.js";
import { Fault } from "./errors.js";
const manager = {
  kind: "staff" as const,
  id: "local-manager",
  roles: ["MANAGER"],
};
const customer = { kind: "customer" as const, id: "local-customer", roles: [] };
const service = new Service(new MemoryStore(), {
  outletId: "main",
  latitude: 28.45,
  longitude: 77.02,
  radiusKm: 3,
  pickupAddress:"Synthetic local café — development only",
  ordersEnabled: true,
  bookingEnabled: true,
  bookingMaxMinutes: 180,
  bookingBufferMinutes: 15,
  openingUtcHour: 0,
  closingUtcHour: 24,
  otpPepper: "local-only-test-pepper-do-not-deploy-12345",
  now: () => new Date(),
});
await service.saveProduct(manager, {
  sku: "meal",
  name: "Sample vegetarian meal",
  category: "Meals",
  pricePaise: 12000,
  stock: 20,
  available: true,
  vegetarian: true,
  addons: { cheese: 2000 },
});
const app = createApp(service, {
  async authenticate(header) {
    if (header === "Bearer local-customer") return customer;
    if (header === "Bearer local-manager") return manager;
    throw new Fault(401, "invalid_local_token");
  },
});
await app.listen({ host: "127.0.0.1", port: 3000 });
