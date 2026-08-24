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
    await expect(page.getByTestId("chapter-play").first()).toBeVisible({ timeout: 5 * 60_000 });

    await page.getByTestId("book-read-link").click();

    // Kokoro reports per-word timings, so a cue is a sentence rather than a whole chunk
    await expect(page.getByTestId("reader-granularity")).toHaveText("word");

    const rect = page.getByTestId("cue-rect").first();
    await expect(rect).toBeVisible();

    const audioTime = () => page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime);
    expect(await audioTime()).toBe(0);

    // Tapping a later sentence moves the narration to it — the move a linear player can't make.
    // Page view is used so a rect's page coordinates are the host's own coordinates.
    await page.getByTestId("reader-view-page").click();
    await expect(page.getByTestId("cue-rect").first()).toBeVisible();

    const target = await page.evaluate(async () => {
      const bookId = location.pathname.split("/")[2];
      const manifest = await (await fetch(`/read/book/${bookId}/book.json`)).json();
      const chapter = manifest.chapters.find((entry: { audio: string | null }) => entry.audio);
      const doc = await (await fetch(chapter.cues)).json();
      const cue = doc.cues.find((entry: { t: number[]; r?: number[][] }) => entry.t[0] > 0 && entry.r?.length);
      if (!cue) return null;

      const [pageIndex, x, y, width, height] = cue.r[0];
      const host = document.querySelector(`[data-page-index="${pageIndex}"] [data-testid="reader-page"]`);
      if (!host) return null;
      host.scrollIntoView({ block: "center" });

      const box = host.getBoundingClientRect();
      return {
        text: cue.s,
        x: box.left + (box.width * (x + width / 2)) / 10_000,
        y: box.top + (box.height * (y + height / 2)) / 10_000,
      };
    });
    expect(target).not.toBeNull();

    await page.mouse.click(target!.x, target!.y);
    await expect.poll(audioTime).toBeGreaterThan(0);
    await expect(page.getByTestId("reader-cue-text")).toHaveText(target!.text);

    // A4 pages are too wide to read whole on a phone, and the reader says so
    await page.getByTestId("reader-width-phone").click();
    await expect(page.getByTestId("reader-too-small")).toBeVisible();
  });
});
