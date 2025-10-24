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
  let prices= signal.prices;
  if(!prices){
    prices= symbols.map(_=>0);
  }
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
  const tradableSymbols: string[]= [];
  let tradableSymbolPrices: number[]= [];
  for(let i= 0; i<symbols.length; i++){
    const symbol= symbols[i];
    const position= positions.find(p => p.symbol===symbol);
    const [shouldIgnoreSignal, shouldIgnoreReason]= Util.shouldIgnoreSignal(side, position, config.portfolio[symbol]);
    if(shouldIgnoreSignal){
      logger.info(`[${symbol}] ${shouldIgnoreReason as string}`);
      continue;
    }
    tradableSymbols.push(symbol);
    tradableSymbolPrices.push(prices[i]);
  }
  const results = await Util.executePromises(tradableSymbols.map(
    async (symbol, index) => {
      await orderManager.cancelOrders(symbol);
      let order;
      if (side === OrderSides.BUY) {
        order = orderManager.generateBuyOrder(type, symbol, tradableSymbolPrices[index], capital);
      } else {
        const position = positions.find(position => position.symbol === symbol) as Position;
        order = orderManager.generateSellOrder(type, symbol, tradableSymbolPrices[index], position.qty);
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
      logger.error(`[${tradableSymbols[index]}] Order execution failed | ${describeError(failedResult.reason)}`);
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
      const order = orderManager.generateSellOrder(OrderTypes.OCO, position.symbol, position.entryPrice, position.qty);
      if (order) {
        await orderManager.executeOrder(order);
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
  Cron(config.tpSlCron, async () => {
    await protectPositions();
  });
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
