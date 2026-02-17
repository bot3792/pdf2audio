import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../server/src/router.ts";

export const trpc = createTRPCReact<AppRouter>();
