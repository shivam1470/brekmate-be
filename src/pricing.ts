import { requireThat } from "./errors.js";
export interface QuoteInput {
  subtotalPaise: number;
  availableRewardPaise: number;
  fulfilment: "delivery" | "pickup";
  useRewards: boolean;
}
export function money(n: number) {
  requireThat(
    Number.isSafeInteger(n) && n >= 0 && n <= 100_000_000,
    "invalid_money",
    400,
  );
  return n;
}
export function quote(input: QuoteInput) {
  const subtotalPaise = money(input.subtotalPaise);
  const balance = money(input.availableRewardPaise);
  requireThat(
    ["delivery", "pickup"].includes(input.fulfilment) &&
      typeof input.useRewards === "boolean",
    "invalid_quote",
    400,
  );
  const deliveryFeePaise =
    input.fulfilment === "delivery" && subtotalPaise <= 9900 ? 2000 : 0;
  const rewardUsedPaise = input.useRewards
    ? Math.min(balance, Math.floor(subtotalPaise / 5))
    : 0;
  return {
    subtotalPaise,
    deliveryFeePaise,
    rewardUsedPaise,
    totalPaise: money(subtotalPaise + deliveryFeePaise - rewardUsedPaise),
  };
}
export function quoteBasket(
  input: Omit<QuoteInput, "subtotalPaise"> & {
    lines: {
      sku: string;
      unitPricePaise: number;
      quantity: number;
      addOnPaise: number;
    }[];
  },
) {
  requireThat(
    input.lines.length > 0 && input.lines.length <= 20,
    "invalid_basket",
    400,
  );
  let subtotalPaise = 0;
  for (const line of input.lines) {
    requireThat(
      Number.isInteger(line.quantity) &&
        line.quantity > 0 &&
        line.quantity <= 20,
      "invalid_quantity",
      400,
    );
    subtotalPaise = money(
      subtotalPaise +
        (money(line.unitPricePaise) + money(line.addOnPaise)) * line.quantity,
    );
  }
  return quote({ ...input, subtotalPaise });
}
