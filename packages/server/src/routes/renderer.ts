import { router, publicProcedure } from "../trpc.ts";
import { installRenderer, rendererInstalled } from "../lib/vivliostyle.ts";

export const rendererRouter = router({
  status: publicProcedure.query(async () => ({ installed: await rendererInstalled() })),
  install: publicProcedure.mutation(async () => {
    await installRenderer();
    return { installed: await rendererInstalled() };
  }),
});
