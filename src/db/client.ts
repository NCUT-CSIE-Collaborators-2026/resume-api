import { drizzle } from "drizzle-orm/d1";

export const getDb = (env: { DB: D1Database }) => drizzle(env.DB);
