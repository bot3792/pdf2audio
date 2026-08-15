import { router, publicProcedure } from "../trpc.ts";
import { listSayVoices } from "../lib/say-voices.ts";

export const sayVoicesRouter = router({
  list: publicProcedure.query(() => listSayVoices()),
});
