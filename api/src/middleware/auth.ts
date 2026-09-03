import type { Context, Next } from "hono";
import config from "../config";

export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  if (c.req.header("Authorization") !== config.tokenAuth) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
}
