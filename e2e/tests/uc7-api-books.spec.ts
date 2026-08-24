import { test, expect, API_URL } from "./fixtures.ts";

test("UC7: POST /api/books creates a book with the api badge and its chapters intact", async ({ page, request, profileId }) => {
  const res = await request.post(`${API_URL}/api/books`, {
    headers: { "x-profile-id": profileId },
    data: {
      title: "API Digest",
      client: "e2e",
      chapters: [
        { title: "Story one", text: "The first story of the day, read as a radio segment." },
        { title: "Story two", text: "The second story follows after a short pause." },
      ],
    },
  });
  expect(res.status()).toBe(201);
  const created = await res.json();
  expect(created.chapters).toHaveLength(2);

  await page.goto("/");
  const row = page.getByRole("link", { name: "API Digest" });
  await expect(row).toBeVisible();
  await expect(page.getByTestId("api-badge")).toBeVisible();

  await row.click();
  const rows = page.getByTestId("chapter-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Story one");
});
