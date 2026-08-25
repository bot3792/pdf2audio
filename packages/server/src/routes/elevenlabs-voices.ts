import { router, publicProcedure } from "../trpc.ts";
import { elevenLabsQuota, listElevenLabsVoices } from "../lib/elevenlabs.ts";

export const elevenlabsVoicesRouter = router({
  list: publicProcedure.query(() => listElevenLabsVoices()),
  // A free month is ten minutes of audio, so what is left decides whether the button is worth pressing
  quota: publicProcedure.query(() => elevenLabsQuota().catch(() => null)),
});
