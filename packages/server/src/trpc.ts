import { initTRPC } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { DEFAULT_PROFILE_ID } from "./schema.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function profileIdFromHeader(value: unknown): string {
  return typeof value === "string" && UUID_RE.test(value) ? value : DEFAULT_PROFILE_ID;
}

export function createContext({ req }: CreateFastifyContextOptions) {
  return { profileId: profileIdFromHeader(req.headers["x-profile-id"]) };
}

export type Context = { profileId?: string };

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
