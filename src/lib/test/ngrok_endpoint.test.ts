import express from "express";
import request from "supertest";
import { afterAll, describe, expect, it, jest } from "@jest/globals";

async function createAgent(options?: {
  secret?: string;
  windowMs?: number;
}) {
  jest.resetModules();

  process.env.WEBHOOK_SECRET = options?.secret ?? "unit-test-secret";
  process.env.FRESHNESS_WINDOW_MS = String(options?.windowMs ?? 90_000);

  const { verifyTradingView } = await import("../../middleware/tradingViewAuth");
  const app = express();
  app.use(express.json());
  app.post("/webhook", verifyTradingView, (_req, res) => {
    res.status(204).json({ ok: true });
  });

  return request(app);
}

const originalSecret = process.env.WEBHOOK_SECRET;
const originalWindow = process.env.FRESHNESS_WINDOW_MS;

afterAll(() => {
  if (originalSecret === undefined) {
    delete process.env.WEBHOOK_SECRET;
  } else {
    process.env.WEBHOOK_SECRET = originalSecret;
  }

  if (originalWindow === undefined) {
    delete process.env.FRESHNESS_WINDOW_MS;
  } else {
    process.env.FRESHNESS_WINDOW_MS = originalWindow;
  }
});

describe("TradingView webhook exposed via ngrok", () => {
  it("accepts requests with the correct secret and fresh timestamp", async () => {
    const agent = await createAgent();
    const now = new Date().toISOString();

    await agent
      .post("/webhook")
      .set("x-tradingview-secret", "unit-test-secret")
      .send({ time: now })
      .expect(204);
  });

  it("rejects requests with wrong secret", async () => {
    const agent = await createAgent();
    const now = new Date().toISOString();

    const res = await agent
      .post("/webhook")
      .set("x-tradingview-secret", "invalid-secret")
      .send({ time: now });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ ok: false });
  });

  it("rejects requests with a non-parseable timestamp", async () => {
    const agent = await createAgent();

    const res = await agent
      .post("/webhook")
      .set("x-tradingview-secret", "unit-test-secret")
      .send({ time: "not-a-date" });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("invalid time");
  });

  it("rejects stale requests that fall outside the freshness window", async () => {
    const windowMs = 5_000;
    const agent = await createAgent({ windowMs });
    const past = new Date(Date.now() - (windowMs + 1)).toISOString();

    const res = await agent
      .post("/webhook")
      .set("x-tradingview-secret", "unit-test-secret")
      .send({ time: past });

    expect(res.status).toBe(408);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("stale or early");
  });
});
