import type { RequestHandler } from "express";
import crypto from "crypto";

// Config via env (defaults are sensible)
const WINDOW_MS = Number(process.env.FRESHNESS_WINDOW_MS ?? 90_000); // ±90s
const WEBHOOK_SECRET =
  process.env.WEBHOOK_SECRET || "change_me_to_a_long_random_secret";

// Constant-time compare
function safeEqual(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const A = Buffer.from(a, "utf8");
  const B = Buffer.from(b, "utf8");
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

// Single middleware: checks secret + timestamp freshness
export const verifyTradingView: RequestHandler = (req, res, next) => {
  try {
    const provided = req.get("x-tradingview-secret") ?? req.body?.secret;
    if (!safeEqual(provided, WEBHOOK_SECRET)) {
      return res.status(401).json({ ok: false });
    }

    const t = String(req.body?.time ?? "");
    const ts = Date.parse(t);
    if (!Number.isFinite(ts)) {
      return res.status(400).json({ ok: false, error: "invalid time" });
    }

    const now = Date.now();
    if (Math.abs(now - ts) > WINDOW_MS) {
      return res.status(408).json({ ok: false, error: "stale or early" });
    }

    return next();
  } catch {
    return res.status(400).json({ ok: false });
  }
};
