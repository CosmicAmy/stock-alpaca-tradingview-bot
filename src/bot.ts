import "./env";
import { server } from "./lib/server";
import { alpaca } from "./lib/alpaca";
import config from '../config.json';
import { logger } from "./lib/logger";
import { orderManager } from "./lib/order_manager";
import { Util } from "./lib/util";
import { describeError } from "./lib/errorHelpers";
import { Account, OrderSide, OrderSides, OrderType, OrderTypes, Position, Signal } from "./lib/model";
import Cron from "croner";
import { verifyTradingView } from "./middleware/tradingViewAuth";


async function processSignal(signal: Signal){
  const {symbols, side, type}= signal;
  if (type !== OrderTypes.MARKET) {
    logger.warn(`Signal ignored: unsupported order type "${type}". Only market orders are executed.`);
    return;
  }
  const inputPrices = signal.prices ?? [];
  let account: Account;
  let positions: Position[]= [];
  try{
    account = await alpaca.getAccount();
    positions = await alpaca.getPositions();
  }catch(e){
    logger.error(`Failed to load account and positions | ${describeError(e)}`);
    return;
  }
  let capital= account.cash;
  positions
    //.filter(position => config.portfolio[position.symbol])
    .forEach(position => capital += position.cost);
  const tradableEntries: {
    rawSymbol: string;
    symbol: string;
    price: number;
    position?: Position;
  }[] = [];
  for (const [index, rawSymbol] of symbols.entries()){
    const symbol = Util.normalizeSymbol(rawSymbol);
    const position= positions.find(p => p.symbol===symbol);
    const [shouldIgnoreSignal, shouldIgnoreReason]= Util.shouldIgnoreSignal(side, position, config.portfolio[symbol]);
    if(shouldIgnoreSignal){
      logger.info(`[${rawSymbol}] ${shouldIgnoreReason as string}`);
      continue;
    }
    let price: number | undefined = inputPrices[index];
    if (price === undefined || price === null) {
      if (type === OrderTypes.MARKET) {
        price = await alpaca.getLatestPrice(symbol);
      } else if (position) {
        price = Number(position.entryPrice);
      }
    }
    if (typeof price === "string") {
      price = Number(price);
    }
    if (price === undefined || !Number.isFinite(price) || price <= 0) {
      if (type === OrderTypes.MARKET) {
        price = await alpaca.getLatestPrice(symbol);
      }
    }
    if (price === undefined || !Number.isFinite(price) || price <= 0) {
      logger.error(`[${rawSymbol}] Unable to determine price for order; skipping signal`);
      continue;
    }
    tradableEntries.push({ rawSymbol, symbol, price, position });
  }
  const results = await Util.executePromises(tradableEntries.map(
    async ({ rawSymbol, symbol, price, position }) => {
      await orderManager.cancelOrders(symbol);
      let order;
      if (side === OrderSides.BUY) {
        order = orderManager.generateBuyOrder(type, symbol, price, capital);
      } else {
        if (!position) {
          logger.warn(`[${rawSymbol}] Sell signal ignored after validation; position not found`);
          return;
        }
        order = orderManager.generateSellOrder(type, symbol, price, position.qty);
      }
      if (order) {
        await orderManager.executeOrder(order);
      }
    }
  ));
  results
    .filter(result => result.status !== 'fulfilled')
    .forEach((result, index) => {
      const failedResult = result as PromiseRejectedResult;
      if ((failedResult.reason as any)?.__logged) {
        return;
      }
      const { rawSymbol } = tradableEntries[index];
      logger.error(`[${rawSymbol}] Order execution failed | ${describeError(failedResult.reason)}`);
    });
}
async function protectPositions(){
  let positions: Position[];
  try{
    positions = (await alpaca.getPositions()).filter(p => config.portfolio[p.symbol]);
  }catch(error){
    logger.error(`protectPositions failed to load positions | ${describeError(error)}`);
    return;
  }
  for(const position of positions){
    let orders;
    try{
      orders = await alpaca.getOpenOrders(position.symbol);
    }catch(error){
      logger.error(`[${position.symbol}] Failed to load open orders | ${describeError(error)}`);
      continue;
    }
    if(orders.length===0 || orders.find(order => order.side==='sell')===undefined){
      const protectiveOrder = orderManager.generateProtectiveOrder(position.symbol, position.entryPrice, position.qty);
      if (protectiveOrder) {
        await orderManager.executeOrder(protectiveOrder);
      }
    }
  }
}
async function openTpSlOrders(position){
}

async function start(){
  await server.start(config.port);
  alpaca.configure(config.account);
  orderManager.configure(config.portfolio, config.defaults);
  if (config.enableProtectiveOrders) {
    Cron(config.tpSlCron, async () => {
      await protectPositions();
    });
  } else {
    logger.info('Protective orders disabled; skipping scheduled TP/SL checks.');
  }
  server.addWebhook(config.endpoint, verifyTradingView, (req, res) => {
    const signal= req.body;
    res.send('');
    res.end();
    logger.info(`Received signal : ${JSON.stringify(signal)}`);
    const [isValidSignal, signalError]= Util.isValidSignal(signal);
    if(isValidSignal){
      processSignal(signal);
    }else{
      logger.error(`Invalid signal. ${signalError}`);
    }
  });

}


start();
