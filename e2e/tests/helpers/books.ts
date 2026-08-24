import { expect, type APIRequestContext, type Page } from "@playwright/test";
import path from "node:path";
import { API_URL } from "./env.ts";

export const FIXTURE_PDF = path.resolve(import.meta.dirname, "../../fixtures/tiny-book.pdf");

export async function createApiBook(
  request: APIRequestContext,
  profileId: string,
  data: { title: string; chapters: { title: string; text: string }[]; voice?: string },
) {
  const res = await request.post(`${API_URL}/api/books`, {
    headers: { "x-profile-id": profileId },
    data: { client: "e2e", ...data },
  });
  expect(res.status()).toBe(201);
  return res.json();
}

export async function uploadFixtureBook(page: Page, { waitForIndex = false } = {}) {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_PDF);
  await page.getByRole("button", { name: /^Upload$/ }).click();
  const row = page.getByRole("row", { name: /tiny.book/i });
  await expect(row).toBeVisible();
  if (waitForIndex) await expect(row.getByTestId("index-badge-done")).toBeVisible({ timeout: 4 * 60_000 });
  await row.getByRole("link", { name: /tiny.book/i }).click();
  await expect(page.getByTestId("raw-book-block")).toContainText(/Raw text extracted/);
}
