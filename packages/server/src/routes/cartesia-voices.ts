import { router, publicProcedure } from "../trpc.ts";
import { listCartesiaVoices } from "../lib/cartesia.ts";

export const cartesiaVoicesRouter = router({
  list: publicProcedure.query(() => listCartesiaVoices()),
});
