import { test, expect, createApiBook, uploadFixtureBook } from "./fixtures.ts";

test("UC8: read along is offered only once a chapter has audio", async ({ page, request, profileId }) => {
  await createApiBook(request, profileId, {
    title: "Nothing Spoken Yet",
    chapters: [{ title: "Only text", text: "A chapter that has never been synthesized." }],
  });

  await page.goto("/");
  await page.getByRole("link", { name: "Nothing Spoken Yet" }).click();

  const entry = page.getByTestId("book-read-link");
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute("title", /No chapter has audio yet/);
});

// marker_single and Kokoro both run for real here — full tier only (pnpm e2e:full)
test.describe("read along on the page", { tag: "@slow" }, () => {
  test("UC8: the spoken sentence is highlighted on the PDF page, and tapping one seeks to it", async ({ page }) => {
    test.setTimeout(20 * 60_000);

    await uploadFixtureBook(page);
    await page.getByTestId("extract-chapters").click();
    await expect(page.getByTestId("chapter-row").first()).toBeVisible({ timeout: 10 * 60_000 });

    await page.getByTestId("open-synthesize").click();
    await page.getByTestId("synthesize-start").click();
    // Every chapter, not just the first to finish: the reader opens on one of them
    await expect(page.getByTestId("chapter-play")).toHaveCount(3, { timeout: 5 * 60_000 });

    await page.getByTestId("book-read-link").click();

    // Kokoro reports per-word timings, so a cue is a sentence rather than a whole chunk
    await expect(page.getByTestId("reader-granularity")).toHaveText("word");

    const rect = page.getByTestId("cue-rect").first();
    await expect(rect).toBeVisible();

    const audioTime = () => page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime);
    expect(await audioTime()).toBe(0);

    // Page view, so a rect's page coordinates are the host element's own coordinates
    await page.getByTestId("reader-view-page").click();
    await expect(page.getByTestId("cue-rect").first()).toBeVisible();

    const target = await page.evaluate(async () => {
      const bookId = location.pathname.split("/")[2];
      const manifest = await (await fetch(`/read/book/${bookId}/book.json`)).json();
      const chapter = manifest.chapters.find((entry: { audio: string | null }) => entry.audio);
      const doc = await (await fetch(chapter.cues)).json();
      const cue = doc.cues.find(
        (entry: { t: number[]; r?: number[][]; wr?: number[][][] }) =>
          entry.t[0] > 0 && entry.r?.length && entry.wr?.some((rects) => rects.length),
      );
      if (!cue) return null;

      const word = cue.w[cue.wr.findIndex((rects: number[][]) => rects.length)];
      return { startMs: cue.t[0] as number, rect: cue.r[0] as number[], wordMs: (word[0] + word[1]) / 2 };
    });
    expect(target).not.toBeNull();

    const [pageIndex, x, y, rectWidth, rectHeight] = target!.rect;
    const host = page.locator(`[data-page-index="${pageIndex}"] [data-testid="reader-page"]`);
    const box = (await host.boundingBox())!;
    await host.click({
      position: {
        x: (box.width * (x + rectWidth / 2)) / 10_000,
        y: (box.height * (y + rectHeight / 2)) / 10_000,
      },
    });
    await expect.poll(audioTime).toBeCloseTo(target!.startMs / 1000, 1);

    // Mid-word, the word being spoken is marked on the page inside its sentence
    await page.locator("audio").evaluate((el: HTMLAudioElement, ms: number) => { el.currentTime = ms / 1000; }, target!.wordMs);
    await expect(page.getByTestId("cue-word-rect").first()).toBeVisible();

    // A4 pages are too wide to read whole on a phone, and the reader says so
    await page.getByTestId("reader-width-phone").click();
    await expect(page.getByTestId("reader-too-small")).toBeVisible();
  });
});
