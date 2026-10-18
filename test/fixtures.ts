import type { Actor, Config } from "../src/service.js";
import type { Service } from "../src/service.js";
export const customer: Actor = {
  kind: "customer",
  id: "customer-1",
  roles: [],
};
export const manager: Actor = {
  kind: "staff",
  id: "manager-1",
  roles: ["MANAGER"],
};
export const fixtureConfig: Config = {
  outletId: "main",
  latitude: 28.45,
  longitude: 77.02,
  radiusKm: 3,
  ordersEnabled: true,
  bookingEnabled: true,
  bookingMaxMinutes: 180,
  bookingBufferMinutes: 15,
  openingUtcHour: 0,
  closingUtcHour: 24,
  otpPepper: "test-only-pepper-012345678901234567890",
  now: () => new Date("2029-01-01T00:00:00Z"),
};
export async function seed(service: Service) {
  await service.saveProduct(manager, {
    sku: "meal",
    name: "Vegetarian meal",
    category: "Meals",
    pricePaise: 12000,
    stock: 2,
    available: true,
    vegetarian: true,
    addons: { cheese: 2000 },
  });
}

const accepted = new WeakMap<Service, Map<string, string>>();
export async function place(
  service: Service,
  actor: Actor,
  input: any,
  attempt: string,
) {
  const cache = accepted.get(service) ?? new Map<string, string>();
  accepted.set(service, cache);
  const k = actor.id + ":" + attempt;
  const body = {
    ...input,
    ...(input.address
      ? {
          address: {
            recipientName: "Fixture Customer",
            phone: "+919876543210",
            ...input.address,
          },
        }
      : {}),
  };
  let token = cache.get(k);
  if (!token) {
    token = (await service.basket(actor, body)).quoteToken;
    cache.set(k, token);
  }
  return service.checkout(actor, { ...body, quoteToken: token }, attempt);
}
