import _Alpaca from '@alpacahq/alpaca-trade-api';
import { Account, AlpacaConfig, AlpacaOrder, Position } from './model';
import { logger } from './logger';
import { describeError } from './errorHelpers';


class Alpaca{
  private _alpaca: _Alpaca;
  constructor(config: AlpacaConfig) {
    this._alpaca= new _Alpaca(config);
  }
  configure(config: AlpacaConfig){
    this._alpaca= new _Alpaca(config);
  }
  async createOrder(request: AlpacaOrder){
    logger.debug(JSON.stringify(request));
    return await this._alpaca.createOrder(request);
  }
  async cancelOrder(id: string){
    await this._alpaca.cancelOrder(id);
  }
  async getOpenOrders(symbol){
    //@ts-ignore
    return await this._alpaca.getOrders({status: 'open', symbols: symbol, until: new Date(), limit: 30});
  }
  async getPositions(): Promise<Position[]>{
      return (await this._alpaca.getPositions()).map(alpacaPosition => new Position(alpacaPosition));
  }
  async getAccount(): Promise<Account>{
      return new Account(await this._alpaca.getAccount());
  }
  async getLatestPrice(symbol: string): Promise<number | undefined> {
    try{
      const trade = await this._alpaca.getLatestTrade(symbol);
      const price =
        (trade as any)?.Price ??
        (trade as any)?.price ??
        (trade as any)?.p ??
        (trade as any)?.trade?.Price;
      const normalized = typeof price === "string" ? Number(price) : Number(price);
      if (Number.isFinite(normalized) && normalized > 0){
        return normalized;
      }
      logger.warn(`[${symbol}] Received invalid latest trade price: ${price}`);
      return undefined;
    }catch(error){
      logger.error(`[${symbol}] Failed to fetch latest trade price | ${describeError(error)}`);
      return undefined;
    }
  }
}

export const alpaca= new Alpaca({paper: true, keyId: 'xyz', secretKey: 'zyx'});
