#!/usr/bin/env node
// Builds a podcast-style audiobook from today's top Hacker News stories via the
// external API (docs/synthetic-books-api.md). Zero dependencies.
//
// Usage: node scripts/hn-top10.mjs [--count 10] [--synthesize] [--api http://localhost:3034] [--model deepseek-v4-flash]
// Needs DEEPSEEK_API_KEY (env or root .env).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const COUNT = Number(opt("--count", "10"));
const API = opt("--api", "http://localhost:3034").replace(/\/$/, "");
const MODEL = opt("--model", "deepseek-v4-flash");
const SYNTHESIZE = flag("--synthesize");

const ARTICLE_CAP = 12_000;
const COMMENTS_CAP = 6_000;

function deepseekKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  try {
    const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
    const match = readFileSync(envFile, "utf8").match(/^DEEPSEEK_API_KEY=(.+)$/m);
    if (match) return match[1].trim();
  } catch {}
  console.error("DEEPSEEK_API_KEY not found (env or root .env)");
  process.exit(1);
}

async function getJson(url, timeoutMs = 30_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(p|div|br|li|h[1-6]|tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .trim();
}

async function fetchArticle(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: { "User-Agent": "Mozilla/5.0 (pdf2audio hn-top10 script)" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html") && !type.includes("text/plain")) return null;
    const body = await res.text();
    const main = body.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? body.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? body;
    const text = stripHtml(main);
    return text.length > 200 ? text.slice(0, ARTICLE_CAP) : null;
  } catch {
    return null;
  }
}

function collectComments(item) {
  const out = [];
  let total = 0;
  const walk = (nodes, depth) => {
    for (const node of nodes ?? []) {
      if (total >= COMMENTS_CAP) return;
      if (node.text) {
        const text = stripHtml(node.text).slice(0, 800);
        const line = `${"  ".repeat(depth)}- ${node.author ?? "anon"}: ${text}`;
        out.push(line);
        total += line.length;
      }
      if (depth < 1) walk(node.children, depth + 1);
    }
  };
  walk(item.children, 0);
  return out.join("\n");
}

const SYSTEM = `You write chapters for a daily tech news podcast, one chapter per Hacker News story. The text will be read aloud by a text-to-speech voice.

Rules:
- Plain spoken prose only: no markdown, no headings, no bullet points, no URLs, no quotation formatting.
- Open with a curiosity hook — one or two sentences that make the listener want to hear the rest. Never open with "Today" or the story title verbatim.
- Then tell the story: what happened, why it matters, the interesting technical or human details. This is the heart of the chapter.
- End with the community's reaction, introduced explicitly (for example "So what does the Hacker News crowd make of this?"). Summarize the main camps or sharpest points briefly. This closing section must take up NO MORE than 20% of the chapter — the story is the star, not the comments.
- Around 400-600 words total.
- Output ONLY the chapter text.`;

async function summarize(key, story, article, comments) {
  const user = [
    `Story title: ${story.title}`,
    story.url ? `Link domain: ${new URL(story.url).hostname}` : "",
    `Points: ${story.points ?? "?"}, comments: ${story.num_comments ?? "?"}`,
    article ? `ARTICLE TEXT:\n${article}` : "ARTICLE TEXT: (could not be fetched — work from the title and discussion, and say so naturally if needed)",
    comments ? `HACKER NEWS DISCUSSION:\n${comments}` : "HACKER NEWS DISCUSSION: (none)",
  ].filter(Boolean).join("\n\n");

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
      temperature: 1.0,
      stream: false,
    }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("DeepSeek returned an empty response");
  return content;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    }),
  );
  return results;
}

const key = deepseekKey();

console.log(`Fetching top ${COUNT} Hacker News stories...`);
const ids = (await getJson("https://hacker-news.firebaseio.com/v0/topstories.json")).slice(0, COUNT);

const chapters = await mapLimit(ids, 3, async (id, i) => {
  const story = await getJson(`https://hn.algolia.com/api/v1/items/${id}`);
  console.log(`[${i + 1}/${ids.length}] ${story.title}`);
  const article = story.url ? await fetchArticle(story.url) : stripHtml(story.text ?? "") || null;
  const comments = collectComments(story);
  const text = await summarize(key, story, article, comments);
  console.log(`[${i + 1}/${ids.length}] summarized (${text.split(/\s+/).length} words${article ? "" : ", article unavailable"})`);
  return {
    title: story.title,
    text,
    url: story.url ?? `https://news.ycombinator.com/item?id=${id}`,
  };
});

const date = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const res = await fetch(`${API}/api/books`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    title: `Hacker News Top ${ids.length} — ${date}`,
    client: "hn-top10",
    chapters,
    synthesize: SYNTHESIZE,
  }),
});
if (!res.ok) {
  console.error(`API error ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const book = await res.json();
console.log(`\nCreated "${book.title}" (${book.chapters.length} chapters)${SYNTHESIZE ? ", synthesis queued" : ""}`);
console.log(`http://localhost:3033/books/${book.id}`);
