import { db } from "../db.ts";
import { books, type ChapterProposal, type ChapterProposalBoundary } from "../schema.ts";
import { eq } from "drizzle-orm";
import { collectBlocksFromMarkerOutput, findMarkerJson, detectBoundaryIndices, matchBoundariesToBlocks } from "../lib/marker.ts";
import { detectChaptersWithLlm } from "../lib/chapter-detect.ts";
import { listMarkerSources } from "../lib/marker-sources.ts";
import { appendLog } from "../lib/log.ts";

export type ProposePayload = {
  bookId: string;
  method: "llm" | "deterministic";
};

export async function propose(payload: ProposePayload) {
  const { bookId, method } = payload;
  const log = (msg: string) => appendLog(bookId, msg);

  const [book] = await db.select().from(books).where(eq(books.id, bookId));
  if (!book) throw new Error(`Book ${bookId} not found`);

  const createdAt = book.chapterProposal?.createdAt ?? new Date().toISOString();

  try {
    const sources = await listMarkerSources(book);
    const boundaries: ChapterProposalBoundary[] = [];
    let detection: ChapterProposal["detection"];

    for (const source of sources) {
      const allBlocks = await collectBlocksFromMarkerOutput(source.outDir);
      let indices: number[] = [];

      if (method === "llm") {
        const markerJsonPath = await findMarkerJson(source.outDir);
        const llmBoundaries = await detectChaptersWithLlm(markerJsonPath, source.pdfPath, log);
        if (llmBoundaries && llmBoundaries.length >= 2) {
          indices = matchBoundariesToBlocks(allBlocks, llmBoundaries);
          detection = "llm";
        } else {
          await log(`LLM returned no usable chapters for "${source.filename}"`);
        }
      } else {
        const detected = detectBoundaryIndices(allBlocks);
        if (detected) {
          indices = detected.indices;
          detection = detected.method;
        } else {
          await log(`No chapter headings detected for "${source.filename}"`);
        }
      }

      for (const i of indices) {
        boundaries.push({ fileIndex: source.fileIndex, blockIndex: i, title: allBlocks[i].text, page: allBlocks[i].page });
      }
    }

    await log(`Proposal ready: ${boundaries.length} chapter boundar${boundaries.length === 1 ? "y" : "ies"} (${method})`);
    await db
      .update(books)
      .set({ chapterProposal: { status: "done", method, detection, boundaries, createdAt }, updatedAt: new Date() })
      .where(eq(books.id, bookId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(`Chapter proposal failed: ${message}`);
    await db
      .update(books)
      .set({ chapterProposal: { status: "failed", method, error: message, createdAt }, updatedAt: new Date() })
      .where(eq(books.id, bookId));
    throw err;
  }
}
