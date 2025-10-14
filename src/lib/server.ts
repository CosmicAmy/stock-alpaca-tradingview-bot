import express, { Express, RequestHandler } from "express";
import { ParamsDictionary } from "express-serve-static-core";
import { ParsedQs } from "qs";

export type HTTP_METHOD = "get" | "post";

class Server {
  private app: Express;
  constructor() {
    this.app = express();
    this.app.use(express.json({ limit: "64kb" }));
    this.app.use(express.urlencoded({ extended: false }));
  }

  // NEW: allow multiple handlers/middlewares
  addEndpoint(
    endpoint: string,
    method: HTTP_METHOD,
    ...callbacks: RequestHandler<ParamsDictionary, any, any, ParsedQs, Record<string, any>>[]
  ) {
    this.app[method](endpoint, ...callbacks);
  }

  addWebhook(
    endpoint: string,
    ...callbacks: RequestHandler<ParamsDictionary, any, any, ParsedQs, Record<string, any>>[]
  ) {
    this.addEndpoint(endpoint, "post", ...callbacks);
  }

  async start(port: number) {
    return new Promise<void>((resolve, reject) => {
      try {
        this.app.listen(port, () => resolve());
      } catch (e: any) {
        reject(e.message);
      }
    });
  }
}

export const server = new Server();
