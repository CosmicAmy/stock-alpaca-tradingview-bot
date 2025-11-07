import { alpaca } from './alpaca';
import { logger } from './logger';
import {
  BuyMarketOrder,
  Order,
  SellLimitOrder,
  SellMarketOrder,
  SellOCOOrder,
  SellStopOrder
} from './order';
import { OrderSettings, OrderType, OrderTypes, Portfolio } from './model';
import { describeError, wrapError } from './errorHelpers';


const DEFAULT_PORTFOLIO= {};
const DEFAULT_ORDER_SETTINGS= {
  allocation: 0,
  entryLimitOffset: 0,
  exitLimitOffset: 0,
  entryStopOffset: 0,
  exitStopOffset: 0,
  entryStopLimitOffset: 0,
  exitStopLimitOffset: 0,
  takeProfit: 0,
  stopLoss: 0
}

class OrderManager{
  constructor(private portfolio: Portfolio, private defaults: OrderSettings){
  }
  private calculateOrderQty(symbol: string, price: number, capital: number){
    const settings = this.portfolio[symbol] || {};
    const allocation = settings.allocation ?? this.defaults.allocation;
    const numericPrice = Number(price);
    if(!Number.isFinite(numericPrice) || numericPrice<=0){
      logger.warn(`[${symbol}] Invalid price "${price}" for sizing; skipping order.`);
      return 0;
    }
    const rawQty = (capital*allocation/100)/numericPrice;
    if(!Number.isFinite(rawQty)){
      logger.warn(`[${symbol}] Computed quantity ${rawQty} is not finite; skipping order.`);
      return 0;
    }
    if (rawQty <= 0) {
      logger.warn(`[${symbol}] Computed order quantity is not positive (${rawQty}); skipping order.`);
      return 0;
    }
    const qty = Math.max(1, Math.round(rawQty));
    if (qty === 1 && rawQty < 1) {
      logger.info(`[${symbol}] Computed allocation resulted in <1 share; defaulting to 1 share.`);
    }
    return qty;
  }
  private generateClientOrderId(symbol: string){
    return `${symbol}_FF_${Date.now()}`;
  }
  private roundPrice(price: number){
    return Number(Number(price).toFixed(2));
  }
  private getSymbolConfig(symbol: string){
    return this.portfolio[symbol] || {};
  }
  private calculateEntryLimitPrice(symbol:string, currentPrice:number){
    const symbolConfig = this.getSymbolConfig(symbol);
    const entryOffset= symbolConfig.entryLimitOffset ?? this.defaults.entryLimitOffset;
    return this.roundPrice(currentPrice*(1-entryOffset/100));
  }
  private calculateExitLimitPrice(symbol: string, currentPrice: number){
    const symbolConfig = this.getSymbolConfig(symbol);
    const exitOffset= symbolConfig.exitLimitOffset ?? this.defaults.exitLimitOffset;
    return this.roundPrice(currentPrice*(1+exitOffset/100));
  }
  private calculateEntryStopPrice(symbol:string, currentPrice:number){
    const symbolConfig = this.getSymbolConfig(symbol);
    const entryOffset= symbolConfig.entryStopOffset ?? this.defaults.entryStopOffset;
    return this.roundPrice(currentPrice*(1+entryOffset/100));
  }
  private calculateExitStopPrice(symbol: string, currentPrice: number){
    const symbolConfig = this.getSymbolConfig(symbol);
    const exitOffset= symbolConfig.exitStopOffset ?? this.defaults.exitStopOffset;
    return this.roundPrice(currentPrice*(1-exitOffset/100));
  }
  private calculateEntryStopLimitPrice(symbol:string, stopPrice:number){
    const symbolConfig = this.getSymbolConfig(symbol);
    const entryOffset= symbolConfig.entryStopLimitOffset ?? this.defaults.entryStopLimitOffset;
    return this.roundPrice(stopPrice*(1-entryOffset/100));
  }
  private calculateExitStopLimitPrice(symbol: string, stopPrice: number){
    const symbolConfig = this.getSymbolConfig(symbol);
    const exitOffset= symbolConfig.exitStopLimitOffset ?? this.defaults.exitStopLimitOffset;
    return this.roundPrice(stopPrice*(1+exitOffset/100));
  }
  private calculateTakeProfitPrice(symbol:string, entryPrice:number){
    const symbolConfig = this.getSymbolConfig(symbol);
    const takeProfitOffset= symbolConfig.takeProfit ?? this.defaults.takeProfit ?? 0;
    if(takeProfitOffset===0){
      return 0;
    }
    return this.roundPrice(entryPrice*(1+takeProfitOffset/100));
  }
  private calculateStopLossPrice(symbol: string, currentPrice: number){
    const symbolConfig = this.getSymbolConfig(symbol);
    const stopLossOffset= symbolConfig.stopLoss ?? this.defaults.stopLoss ?? 0;
    if(stopLossOffset===0){
      return 0;
    }
    return this.roundPrice(currentPrice*(1-stopLossOffset/100));
  }
  configure(portfolio: Portfolio, defaults: OrderSettings){
    this.portfolio= portfolio;
    this.defaults= defaults;
  }
  generateBuyOrder(type: OrderType, symbol: string, price: number, capital: number): Order|undefined {
    if (type !== OrderTypes.MARKET){
      logger.warn(`[${symbol}] Unsupported buy order type "${type}". Only market orders are submitted.`);
      return undefined;
    }
    const qty = this.calculateOrderQty(symbol, price, capital);
    return qty>0 ? new BuyMarketOrder(symbol, qty) : undefined;
  }
  generateSellOrder(type: OrderType, symbol: string, price: number, qty: number): Order|undefined {
    if (type !== OrderTypes.MARKET){
      logger.warn(`[${symbol}] Unsupported sell order type "${type}". Only market orders are submitted.`);
      return undefined;
    }
    return new SellMarketOrder(symbol, qty);
  }
  generateProtectiveOrder(symbol: string, entryPrice: number, qty: number): Order | undefined {
    const takeProfitPrice = this.calculateTakeProfitPrice(symbol, entryPrice);
    const stopLossPrice = this.calculateStopLossPrice(symbol, entryPrice);

    if (takeProfitPrice === 0 && stopLossPrice === 0) {
      logger.debug(`[${symbol}] No take-profit/stop-loss configured; skipping protective order.`);
      return undefined;
    }

    if (takeProfitPrice > 0 && stopLossPrice > 0) {
      return new SellOCOOrder(symbol, qty, takeProfitPrice, stopLossPrice);
    }

    if (takeProfitPrice > 0) {
      return new SellLimitOrder(symbol, qty, takeProfitPrice);
    }

    if (stopLossPrice > 0) {
      return new SellStopOrder(symbol, qty, stopLossPrice);
    }

    return undefined;
  }
  async cancelOrders(symbol: string){
    let orders;
    try {
      orders = await alpaca.getOpenOrders(symbol);
    } catch (error) {
      logger.error(`[${symbol}] Failed to retrieve open orders | ${describeError(error)}`);
      return;
    }
    if(orders.length===1){
      const order= orders[0];
      logger.info(`[${symbol}] Canceling open ${order.side} order`);
      try {
        await alpaca.cancelOrder(order.id);
      } catch (error) {
        logger.error(
          `[${symbol}] Failed to cancel order ${order.id} | ${describeError(error)}`
        );
      }
    }else if(orders.length>1){
      logger.crit(`[${symbol}] Found ${orders.length} open orders !!`);
    }
  }
  async executeOrder(order:Order){
    const client_order_id= this.generateClientOrderId(order.symbol);
    try {
      return await alpaca.createOrder({ ...order.toAlpacaOrder(), client_order_id });
    } catch (error) {
      const wrapped = wrapError(`submit order ${client_order_id}`, error);
      (wrapped as any).__logged = true;
      logger.error(`[${order.symbol}] ${describeError(wrapped)}`);
      throw wrapped;
    }
  }
}

export const orderManager= new OrderManager(DEFAULT_PORTFOLIO, DEFAULT_ORDER_SETTINGS);
