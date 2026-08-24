import { test, expect, uploadFixtureBook } from "./fixtures.ts";

test("the book page keeps the PDF, disk usage, and action log at hand", async ({ page }) => {
  await uploadFixtureBook(page);

  await page.getByTitle("Preview PDF").click();
  const preview = page.getByTestId("pdf-preview-modal");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("tiny-book.pdf");
  await preview.getByTitle("Close").click();
  await expect(preview).not.toBeVisible();

  await page.getByTestId("disk-usage").click();
  const disk = page.getByTestId("disk-usage-modal");
  await expect(disk).toBeVisible();
  await expect(disk).toContainText(/[KM]?B/);
  await page.keyboard.press("Escape");

  await page.getByTestId("log-dock").click();
  const log = page.getByTestId("log-modal");
  await expect(log).toBeVisible();
  await expect(log).toContainText(/Raw text: .* words/);
});
