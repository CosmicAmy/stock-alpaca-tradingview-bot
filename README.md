# Stock Alpaca TradingView Bot

TypeScript service that listens for TradingView alerts, validates that they are fresh and authentic, and turns them into market orders on Alpaca. The bot keeps a per-symbol configuration, calculates trade sizes, and optionally creates protective take-profit/stop-loss orders on a schedule.

## What the bot does
- Hosts a lightweight Express API that exposes a TradingView webhook endpoint (default port `80`).
- Validates every webhook with a shared secret and a freshness window before accepting it.
- Converts signals into Alpaca orders, applying allocation rules and offset settings from `config.json`.
- Cancels stale orders and creates protective exit orders via a cron-driven job.
- Supports per-symbol overrides for allocation, offsets, and TP/SL behaviour as well as ETF tickers.

## Requirements
- Node.js 18+ and npm.
- An Alpaca account (paper or live) with API key/secret and trading permissions for the symbols you plan to trade.
- A TradingView plan that can send webhook alerts.
- (Optional) Docker and docker-compose plus an `ngrok` token if you prefer tunnelling traffic.

## Quick start
1. **Clone and install**
   ```bash
   git clone https://github.com/amahouachi/stock-alpaca-tradingview-bot
   cd stock-alpaca-tradingview-bot
   npm install
   ```
2. **Build the TypeScript sources**
   ```bash
   npm run build
   ```
3. **Create your runtime configuration**
   ```bash
   cp config.sample.json config.json          # working copy at the project root
   cp config.json dist/config.json            # build output expects config beside dist/src
   ```
   Edit both copies (or symlink/automate the copy) so that `dist/config.json` always matches `config.json`.
4. **Set environment variables**  
   Create a `.env` file or export variables before starting the bot:
   ```
   WEBHOOK_SECRET=long_random_value_shared_with_tradingview
   FRESHNESS_WINDOW_MS=90000        # optional, defaults to 90s
   PORT=80                          # optional override
   ```
5. **Run the bot**
   ```bash
   npm run start                     # runs node dist/src/bot.js
   ```
   You can also run `node dist/src/bot.js` directly or use a process manager such as `pm2 start dist/src/bot.js`.
6. **Point TradingView to the webhook**  
   Use the URL `http(s)://<public-host>:<port><endpoint>` where `<endpoint>` is the `endpoint` field from your config (for example `/tradingview-webhook`). Include the same secret you placed in `.env` either in the alert payload (`"secret": "..."`) or the `x-tradingview-secret` header.

### Docker / tunnelling option
```bash
docker-compose up --build -d
```
`docker-compose.yml` spins up the bot (`tv-webhook`) plus an optional `ngrok` sidecar. Provide `WEBHOOK_SECRET`, `NGROK_AUTHTOKEN`, and (optionally) `NGROK_COMMAND` in your environment before running compose.

## Configuration

### `config.json`
```jsonc
{
  "port": 80,                          // HTTP port to listen on (needs to be 80 for TradingView by default)
  "endpoint": "/tradingview-webhook",  // Webhook path used in your TradingView alert
  "tpSlCron": "*/5 * * * *",           // Cron expression for creating take-profit / stop-loss orders
  "account": {
    "paper": true,
    "keyId": "your-alpaca-key",
    "secretKey": "your-alpaca-secret"
  },
  "defaults": {
    "allocation": 5,                   // % of capital allocated per trade
    "entryLimitOffset": 0.1,
    "exitLimitOffset": 0.1,
    "entryStopOffset": 0.1,
    "exitStopOffset": 0.1,
    "entryStopLimitOffset": 0.1,
    "exitStopLimitOffset": 0.1,
    "takeProfit": 10,
    "stopLoss": 5
  },
  "portfolio": {
    "NVDA": { "allocation": 20 },
    "AMD":  { "allocation": 20, "takeProfit": 30, "stopLoss": 25 },
    "NFLX": { "allocation": 15, "active": false },
    "TQQQ": { "allocation": 15, "takeProfit": 0,  "stopLoss": 0 }
  }
}
```
- `defaults` apply to every symbol unless overridden under `portfolio`.
- Set `active: false` on any ticker you want the bot to ignore even if TradingView emits it.
- All offsets are percentages (positive or negative) relative to the signal price; negative values let you chase best bid/ask inside the spread.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `WEBHOOK_SECRET` | Shared secret; must match the alert payload (`secret`) or `x-tradingview-secret` header from TradingView. |
| `FRESHNESS_WINDOW_MS` | Maximum allowed difference (ms) between the alert timestamp and server time (default 90 s). |
| `PORT` | Override HTTP port (otherwise the code uses `config.port`). |
| `WEBHOOK_PATH` | Only used in the Docker image; defaults to `/webhook/...`. |
| `NGROK_AUTHTOKEN` / `NGROK_COMMAND` | Optional values for the tunnelling container. |

## TradingView webhook setup
1. Open your strategy alert and choose **Webhook URL**.
2. Set the URL to `https://<your-host><endpoint>` (for example `https://example.com/tradingview-webhook`).
3. Use a JSON alert body that matches the signal schema below and include `secret` (same value as `WEBHOOK_SECRET`).  
   Example:
   ```json
   {
     "time": "{{timenow}}",
     "secret": "long_random_value",
     "side": "buy",
     "type": "market",
     "symbols": ["NVDA", "AMD"],
     "prices": [{{close}}, {{close}}]
   }
   ```
4. Ensure your script sends the latest close for each ticker—`request.security()` lets you fetch extra symbols inside Pine Script if needed.

The middleware checks both `secret` and `time`. Requests with missing/incorrect secrets or timestamps outside `±FRESHNESS_WINDOW_MS` are rejected with 401/408.

## Signal format

Signals describe *what* to trade; the bot decides *if* it can trade the symbol (based on open positions and config) and *how much* to buy/sell.

```json
{
  "side": "buy" | "sell",
  "type": "market" | "limit" | "stop" | "stop_limit",
  "symbols": ["NVDA", "AMD", "GOOG"],
  "prices": [800.05, 160.45, 200.15]
}
```

- `symbols` and `prices` must be the same length (prices are optional for `market` orders but recommended).
- Only long trades are executed; sell signals without open positions are ignored.
- Mixed-symbol alerts are supported—each ticker is evaluated independently.

### Examples

**Buy Limit**
```json
{
  "side": "buy",
  "type": "limit",
  "symbols": ["NVDA"],
  "prices": [800.05]
}
```

**Sell Stop**
```json
{
  "side": "sell",
  "type": "stop",
  "symbols": ["AMD"],
  "prices": [130.94]
}
```

**Buy Stop-Limit (multiple symbols)**
```json
{
  "side": "buy",
  "type": "stop_limit",
  "symbols": ["NVDA", "AMD", "GOOG"],
  "prices": [800.05, 160.45, 200.15]
}
```

**Sell Market (multiple symbols)**
```json
{
  "side": "sell",
  "type": "market",
  "symbols": ["NVDA", "AMD", "GOOG"]
}
```

## How orders flow
1. The HTTP server accepts the webhook, validates the secret/timestamp, and enqueues the signal.
2. The bot fetches your Alpaca account + positions, derives current capital (cash + cost basis), and normalizes symbols (for example stripping exchanges).
3. Each symbol is checked against the `portfolio` section. If it is inactive, lacks allocation, or violates buy/sell rules, it is skipped.
4. For BUY signals, the bot computes a quantity from capital × allocation; for SELL signals it uses the open position quantity.
5. Offsets from `defaults` or per-symbol overrides are applied to determine limit/stop/stop-limit prices.
6. Orders are submitted via the Alpaca SDK. Failed executions are logged per symbol.

When `tpSlCron` fires, open positions without an existing protective order cause the bot to issue the configured take-profit/stop-loss orders.

## Take profit & stop loss logic

Take-profit and stop-loss orders are *not* placed with the entry order. Instead, the cron job (`tpSlCron`) periodically checks open positions and submits the protective orders that are missing.

- `takeProfit`/`stopLoss` are percentages relative to the entry price:  
  ```
  takeProfitPrice = entryPrice * (1 + takeProfit / 100)
  stopLossPrice   = entryPrice * (1 - stopLoss / 100)
  ```
- If only one of the two values is non-zero, a single `limit` or `stop` order is placed; if both are non-zero the bot creates an Alpaca OCO order.
- Set both values to zero to disable protective orders for that symbol.

## Extended hours & time in force

Because TradingView alerts can arrive outside of regular hours, every order sets `extended_hours = true` with `time_in_force = "day"` (except take-profit/stop-loss, which use `gtc`). Remember that `day` orders expire at the end of the trading session—you need to resend the signal if an order expires unfilled.

## Negative offsets

Offsets can be negative; for example, `entryLimitOffset: -0.1` will buy at *price − 0.1 %*, letting you place passive orders inside the spread. Use this to fine-tune how aggressively the bot chases fills.

## Example Pine Script snippet
```pinescript
//@version=5
strategy("my-strategy", margin_long = 20)

symbols = array.from("AMD","AMZN","AAPL","NVDA")
priceAMD = request.security("NASDAQ:AMD", timeframe.period, close)
priceAMZN = request.security("NASDAQ:AMZN", timeframe.period, close)
priceAAPL = request.security("NASDAQ:AAPL", timeframe.period, close)
priceNVDA = request.security("NASDAQ:NVDA", timeframe.period, close)
prices = array.from(priceAMD, priceAMZN, priceAAPL, priceNVDA)

// Build alert payload
buyCmd = '{"time":"{{timenow}}","secret":"long_random_value","side":"buy","type":"limit","symbols":['
for [index, symbol] in symbols
    buyCmd := buyCmd + '"' + symbol + '"'
    if index < array.size(symbols) - 1
        buyCmd := buyCmd + ','
buyCmd := buyCmd + '],"prices":[' + prices.join(",") + "]}";
if longCondition
    alert(buyCmd)
```

## Example configuration (JSONC)
```jsonc
{
  "port": 80,
  "endpoint": "/my-custom-webhook-endpoint",
  "tpSlCron": "*/5 * * * *",
  "account": {
    "paper": true,
    "keyId": "api key",
    "secretKey": "secret key"
  },
  "defaults": {
    "entryLimitOffset": 0.1,
    "exitLimitOffset": 0.1,
    "entryStopOffset": 0.1,
    "exitStopOffset": 0.1,
    "entryStopLimitOffset": 0.1,
    "exitStopLimitOffset": 0.1,
    "takeProfit": 10,
    "stopLoss": 5
  },
  "portfolio": {
    "NVDA": { "allocation": 20 },
    "AMD":  { "allocation": 20, "takeProfit": 30, "stopLoss": 25 },
    "NFLX": { "allocation": 15, "active": false },
    "TQQQ": { "allocation": 15, "takeProfit": 0, "stopLoss": 0 },
    "AMAT": { "allocation": 10 }
  }
}
```

## Need a recap?
- Configure Alpaca keys + per-symbol settings in `config.json`.
- Protect the webhook with `WEBHOOK_SECRET` and keep alerts fresh (`time` field).
- Run `npm run build && npm run start` (or `docker-compose up`) to keep the bot online.
- Send properly formatted TradingView alerts and the bot will execute/guard your positions automatically.
