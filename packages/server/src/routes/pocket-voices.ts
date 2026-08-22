import { z } from "zod";

import { router, publicProcedure } from "../trpc.ts";
import { POCKET_VOICES, pocketCloningAvailable, pocketEngineInstalled } from "../lib/pocket.ts";
import { deleteCustomPocketVoice, listCustomPocketVoices } from "../lib/pocket-voices.ts";

export const pocketVoicesRouter = router({
  list: publicProcedure.query(async () => {
    const [custom, installed, cloningAvailable] = await Promise.all([
      listCustomPocketVoices(),
      pocketEngineInstalled(),
      pocketCloningAvailable(),
    ]);
    return { voices: POCKET_VOICES, custom, installed, cloningAvailable };
  }),

  deleteCustom: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await deleteCustomPocketVoice(input.id);
      return { ok: true };
    }),
});
