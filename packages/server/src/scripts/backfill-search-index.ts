import { db } from "../db.ts";
import { books } from "../schema.ts";
import { quickAddJob } from "graphile-worker";
import { env } from "../env.ts";

const force = process.argv.includes("--force");
const allBooks = await db.select({ id: books.id, title: books.title, searchIndex: books.searchIndex }).from(books);

let queued = 0;
for (const book of allBooks) {
  if (!force && book.searchIndex?.status === "done") continue;
  await quickAddJob({ connectionString: env.DATABASE_URL }, "indexBook", { bookId: book.id }, {
    maxAttempts: 1,
    jobKey: `index:${book.id}`,
    jobKeyMode: "replace",
  });
  console.log(`Queued indexBook: ${book.title}`);
  queued++;
}

console.log(`Queued indexBook for ${queued} of ${allBooks.length} book(s)`);
process.exit(0);
