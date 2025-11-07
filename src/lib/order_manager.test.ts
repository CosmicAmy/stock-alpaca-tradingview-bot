import { describe, it, beforeEach, expect } from "@jest/globals";
import { orderManager } from "./order_manager";
import { OrderTypes } from "./model";
import {
  SellLimitOrder,
  SellMarketOrder,
  SellOCOOrder,
  SellStopOrder
} from "./order";

const baseDefaults = {
  allocation: 100,
  entryLimitOffset: 0,
  exitLimitOffset: 0,
  entryStopOffset: 0,
  exitStopOffset: 0,
  entryStopLimitOffset: 0,
  exitStopLimitOffset: 0,
  takeProfit: 0,
  stopLoss: 0
};

describe("orderManager order generation", () => {
  beforeEach(() => {
    orderManager.configure(
      { AAPL: {} },
      { ...baseDefaults }
    );
  });

  it("generates market sell orders for market signals", () => {
    const order = orderManager.generateSellOrder(OrderTypes.MARKET, "AAPL", 150, 10);
    expect(order).toBeInstanceOf(SellMarketOrder);
    expect(order?.toAlpacaOrder()).toMatchObject({ type: OrderTypes.MARKET });
  });

  it("defaults to a single share when allocation rounds below one", () => {
    orderManager.configure(
      { AAPL: { allocation: 0.1 } },
      { ...baseDefaults }
    );
    const qty = (orderManager as any).calculateOrderQty("AAPL", 500, 1000);
    expect(qty).toBe(1);
  });

  it("ignores non-market sell order types", () => {
    const order = orderManager.generateSellOrder(OrderTypes.OCO, "AAPL", 150, 10);
    expect(order).toBeUndefined();
  });

  it("does not create protective orders when tp/sl are zero", () => {
    const protective = orderManager.generateProtectiveOrder("AAPL", 150, 10);
    expect(protective).toBeUndefined();
  });

  it("creates OCO protective order when both tp and sl configured", () => {
    orderManager.configure(
      { AAPL: {} },
      { ...baseDefaults, takeProfit: 5, stopLoss: 3 }
    );
    const protective = orderManager.generateProtectiveOrder("AAPL", 100, 10);
    expect(protective).toBeInstanceOf(SellOCOOrder);
    const alpacaOrder = protective?.toAlpacaOrder();
    expect(alpacaOrder?.order_class).toBe("oco");
    expect(alpacaOrder?.take_profit?.limit_price).toBeDefined();
    expect(alpacaOrder?.stop_loss?.stop_price).toBeDefined();
  });

  it("creates limit protective order when only tp configured", () => {
    orderManager.configure(
      { AAPL: {} },
      { ...baseDefaults, takeProfit: 2, stopLoss: 0 }
    );
    const protective = orderManager.generateProtectiveOrder("AAPL", 100, 10);
    expect(protective).toBeInstanceOf(SellLimitOrder);
  });

  it("creates stop protective order when only sl configured", () => {
    orderManager.configure(
      { AAPL: {} },
      { ...baseDefaults, takeProfit: 0, stopLoss: 2 }
    );
    const protective = orderManager.generateProtectiveOrder("AAPL", 100, 10);
    expect(protective).toBeInstanceOf(SellStopOrder);
  });
});
