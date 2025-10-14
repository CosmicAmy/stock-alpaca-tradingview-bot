import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { AlpacaOrder } from "../model";

type AlpacaSdkMock = {
  createOrder: jest.Mock;
  cancelOrder: jest.Mock;
  getOrders: jest.Mock;
  getPositions: jest.Mock;
  getAccount: jest.Mock;
};

const buildSdkMock = (): AlpacaSdkMock => ({
  createOrder: jest.fn(),
  cancelOrder: jest.fn(),
  getOrders: jest.fn(),
  getPositions: jest.fn(),
  getAccount: jest.fn(),
});

const debugSpy = jest.fn();
const instances: Array<{ config: any; instance: AlpacaSdkMock }> = [];

const mockCtor = jest.fn().mockImplementation((config: any) => {
  const instance = buildSdkMock();
  instances.push({ config, instance });
  return instance;
});

jest.mock("@alpacahq/alpaca-trade-api", () => ({
  __esModule: true,
  default: mockCtor,
}));

jest.mock("../logger", () => ({
  logger: {
    debug: debugSpy,
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    crit: jest.fn(),
  },
}));

let alpaca: typeof import("../alpaca")["alpaca"];

beforeEach(async () => {
  jest.resetModules();
  instances.length = 0;
  mockCtor.mockClear();
  debugSpy.mockClear();

  const mod = await import("../alpaca");
  alpaca = mod.alpaca;
});

describe("alpaca client wrapper", () => {
  it("initialises SDK with defaults and reconfigure swaps the instance", async () => {
    expect(instances).toHaveLength(1);
    expect(instances[0].config).toEqual({
      paper: true,
      keyId: "xyz",
      secretKey: "zyx",
    });

    const initialInstance = instances[0].instance;

    const nextConfig = { paper: false, keyId: "abc", secretKey: "def" };
    alpaca.configure(nextConfig);

    expect(mockCtor).toHaveBeenCalledTimes(2);
    expect(instances).toHaveLength(2);
    expect(instances[1].config).toEqual(nextConfig);

    const request: AlpacaOrder = {
      symbol: "AAPL",
      side: "buy",
      type: "market",
      qty: "1",
      time_in_force: "day",
    };

    const latestInstance = instances[1].instance;
    latestInstance.createOrder.mockImplementation(async () => ({
      id: "order-1",
    }));

    const result = await alpaca.createOrder(request);

    expect(initialInstance.createOrder).not.toHaveBeenCalled();
    expect(latestInstance.createOrder).toHaveBeenCalledWith(request);
    expect(result).toEqual({ id: "order-1" });
    expect(debugSpy).toHaveBeenCalledWith(JSON.stringify(request));
  });

  it("cancels orders via the SDK", async () => {
    const current = instances[0].instance;
    current.cancelOrder.mockImplementation(async () => undefined);

    await alpaca.cancelOrder("abc-123");

    expect(current.cancelOrder).toHaveBeenCalledWith("abc-123");
  });

  it("gets open orders with expected filters", async () => {
    const current = instances[0].instance;
    const orders = [{ id: "order-1" }];
    current.getOrders.mockImplementation(async () => orders);

    const result = await alpaca.getOpenOrders("TSLA");

    expect(current.getOrders).toHaveBeenCalledTimes(1);
    const args = current.getOrders.mock.calls[0][0] as Record<string, unknown>;
    expect(args).toEqual(
      expect.objectContaining({
        status: "open",
        symbols: "TSLA",
        limit: 30,
      })
    );
    expect(args.until).toBeInstanceOf(Date);
    expect(result).toBe(orders);
  });

  it("maps raw positions into Position instances", async () => {
    const current = instances[0].instance;
    current.getPositions.mockImplementation(async () => [
      {
        symbol: "MSFT",
        side: "long",
        qty: "10",
        avg_entry_price: "100.5",
        cost_basis: "1005",
      },
    ]);

    const positions = await alpaca.getPositions();

    expect(current.getPositions).toHaveBeenCalled();
    expect(positions).toEqual([
      expect.objectContaining({
        symbol: "MSFT",
        side: "long",
        qty: 10,
        entryPrice: 100.5,
        cost: 1005,
      }),
    ]);
  });

  it("returns Account instance with numeric cash balance", async () => {
    const current = instances[0].instance;
    current.getAccount.mockImplementation(async () => ({ cash: "1234.56" }));

    const account = await alpaca.getAccount();

    expect(current.getAccount).toHaveBeenCalled();
    expect(account.cash).toBe(1234.56);
  });
});
