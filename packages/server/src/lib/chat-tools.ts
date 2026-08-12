import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { and, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "../db.ts";
import { books } from "../schema.ts";
import { searchLibrary, expandPassage, type SearchHit } from "./search.ts";
import { folderSubtreeIds } from "./folders.ts";

export type CitationSource = {
  id: string;
  chunkId: string;
  kind: "raw" | "chapter" | "translation";
  bookId: string;
  bookTitle: string;
  fileId: string | null;
  page: number | null;
  chapterId: string | null;
  chapterTitle: string | null;
  language: string | null;
};

// Stable, verifiable citation ids for one request: tools register every passage
// they return, the model may only cite registered ids (toc-detect discipline)
export class CitationCatalog {
  private byId = new Map<string, CitationSource>();
  private byChunk = new Map<string, string>();
  private next = 1;

  seed(sources: CitationSource[]) {
    for (const source of sources) {
      if (this.byId.has(source.id)) continue;
      this.byId.set(source.id, source);
      this.byChunk.set(source.chunkId, source.id);
      const n = Number(source.id.replace("c_", ""));
      if (Number.isFinite(n) && n >= this.next) this.next = n + 1;
    }
  }

  register(hit: SearchHit): CitationSource {
    const existingId = this.byChunk.get(hit.chunkId);
    if (existingId) return this.byId.get(existingId)!;
    const id = `c_${this.next++}`;
    const source: CitationSource = {
      id,
      chunkId: hit.chunkId,
      kind: hit.source,
      bookId: hit.bookId,
      bookTitle: hit.bookTitle,
      fileId: hit.bookFileId ?? hit.chapterFileId,
      page: hit.pageStart,
      chapterId: hit.chapterId,
      chapterTitle: hit.chapterTitle,
      language: hit.language,
    };
    this.byId.set(id, source);
    this.byChunk.set(hit.chunkId, id);
    return source;
  }

  get(id: string): CitationSource | undefined {
    return this.byId.get(id);
  }
}

function describeHit(source: CitationSource, hit: SearchHit): string {
  const parts = [`"${hit.bookTitle}"`];
  if (hit.chapterTitle) parts.push(`chapter "${hit.chapterTitle}"`);
  if (hit.source === "translation" && hit.language) parts.push(`${hit.language} translation`);
  if (hit.pageStart != null) parts.push(hit.pageEnd != null && hit.pageEnd !== hit.pageStart ? `pp. ${hit.pageStart}–${hit.pageEnd}` : `p. ${hit.pageStart}`);
  return `[${source.id}] ${parts.join(", ")}:\n${hit.text}`;
}

export function buildChatTools(opts: { profileId: string; folderId?: string; bookId?: string; catalog: CitationCatalog }): ToolSet {
  const { profileId, folderId, bookId, catalog } = opts;

  return {
    search_library: tool({
      description:
        "Search the user's book library. Hybrid keyword + semantic search across original book text and translations, in any language. Returns passages labeled with citation ids like [c_3]. Call this before answering; refine the query (or try another language) when results are weak.",
      inputSchema: z.object({
        query: z.string().min(1).max(500).describe("The search query — keywords or a natural-language question"),
        limit: z.number().int().min(1).max(20).optional().describe("Max passages to return (default 8)"),
      }),
      execute: async ({ query, limit }) => {
        const result = await searchLibrary({ profileId, folderId, bookId, query, limit: limit ?? 8 });
        if (result.hits.length === 0) return "No matching passages found. Try different keywords or another language.";
        const blocks = result.hits.map((hit) => describeHit(catalog.register(hit), hit));
        const note = result.mode === "keyword" ? "\n\n(Semantic search unavailable — keyword results only.)" : "";
        return blocks.join("\n\n---\n\n") + note;
      },
    }),

    read_passage: tool({
      description:
        "Read the wider context around a passage previously returned by search_library. Use when a snippet looks relevant but is cut off or you need surrounding detail.",
      inputSchema: z.object({
        id: z.string().regex(/^c_\d+$/).describe("A citation id from search_library, e.g. c_3"),
        before: z.number().int().min(0).max(3).optional().describe("Extra chunks of context before (default 1)"),
        after: z.number().int().min(0).max(3).optional().describe("Extra chunks of context after (default 1)"),
      }),
      execute: async ({ id, before, after }) => {
        const source = catalog.get(id);
        if (!source) return `Unknown citation id ${id} — only ids returned by search_library exist.`;
        const expanded = await expandPassage(source.chunkId, before ?? 1, after ?? 1);
        if (!expanded) return `Passage ${id} is no longer available (the book may have been re-indexed).`;
        return describeHit(source, { ...expanded.hit, text: expanded.text });
      },
    }),

    list_books: tool({
      description:
        "List books in the user's library (titles and sizes, no content). Use for meta questions like 'what books do I have about X' — for content questions use search_library.",
      inputSchema: z.object({
        query: z.string().max(200).optional().describe("Optional title filter"),
      }),
      execute: async ({ query }) => {
        const filters: SQL[] = [eq(books.profileId, profileId)];
        if (bookId) filters.push(eq(books.id, bookId));
        else if (folderId) filters.push(inArray(books.folderId, await folderSubtreeIds(folderId)));
        if (query?.trim()) {
          for (const word of query.trim().split(/\s+/).slice(0, 8)) {
            filters.push(ilike(books.title, `%${word.replace(/[\\%_]/g, "\\$&")}%`));
          }
        }
        const rows = await db
          .select({
            id: books.id,
            title: books.title,
            words: sql<number>`coalesce((SELECT sum(raw_words)::int FROM book_files bf WHERE bf.book_id = ${books.id} AND bf.raw_text IS NOT NULL), 0)`,
          })
          .from(books)
          .where(and(...filters))
          .orderBy(books.title)
          .limit(100);
        if (rows.length === 0) return "No books match.";
        return rows.map((r) => `- ${r.title}${r.words ? ` (~${r.words.toLocaleString()} words)` : ""}`).join("\n");
      },
    }),
  };
}

export const LIBRARY_CHAT_SYSTEM = [
  "You are the library assistant for a personal audiobook/reading app. You answer questions using ONLY passages retrieved from the user's own book library via your tools.",
  "Always search before answering a content question. If the first search is weak, refine the query — try synonyms, different keywords, or the other language (the library mixes English and Bulgarian; you can search in either).",
  "Cite every claim with the citation ids from tool results, inline, like [c_3]. Only use ids that appeared in tool output — never invent ids. If sources disagree, say so.",
  "You have a budget of a few tool-calling rounds per answer. If 3–4 searches with varied queries come up empty, stop searching and say plainly that the library doesn't seem to cover it — do not answer from general knowledge without flagging it as such.",
  "Answer in the language the user asked in. Quote short key phrases from sources where helpful; suggest which book/chapter to read for more detail.",
  "Keep answers focused and concise. Use markdown.",
].join("\n\n");
