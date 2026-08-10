#!/usr/bin/env node
// Builds a podcast-style audiobook from a day's top Hacker News stories via the
// external API (docs/synthetic-books-api.md). Stories come from hckrnews.com's
// per-day archives, so any past day works, not just what's on the HN front page.
//
// Usage: node scripts/hn-top10.mjs [--date 2026-08-09] [--count 10] [--synthesize]
//                                  [--api http://localhost:3034] [--model deepseek-v4-flash]
// Needs DEEPSEEK_API_KEY (env or root .env) and `pnpm install` (defuddle + linkedom).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseHTML } from "linkedom";
import { Defuddle } from "defuddle/node";

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

const toYmd = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const dateArg = opt("--date", null);
const targetYmd = dateArg ? dateArg.replaceAll("-", "") : toYmd(new Date());
if (!/^\d{8}$/.test(targetYmd)) {
  console.error(`Invalid --date "${dateArg}" — use YYYY-MM-DD`);
  process.exit(1);
}

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

// hckrnews day files are `var entries = [...]` JS, keyed by UTC-ish day. A local
// calendar day can span two files, so merge the day, the day after, and latest,
// then cut by local date — this matches the day sections the site renders.
async function fetchDayStories(ymd) {
  const nextDay = new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)) + 1);
  const sources = [`${ymd}.js`, `${toYmd(nextDay)}.js`, "latest.js"];

  const byId = new Map();
  let anyLoaded = false;
  for (const file of sources) {
    const res = await fetch(`https://hckrnews.com/data/${file}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) continue;
    anyLoaded = true;
    const body = await res.text();
    const entries = JSON.parse(body.replace(/^\s*var\s+entries\s*=\s*/, "").replace(/;\s*$/, ""));
    for (const entry of entries) byId.set(entry.id, entry);
  }
  if (!anyLoaded) throw new Error(`hckrnews has no data for ${ymd}`);

  return [...byId.values()]
    .filter((e) => e.type === "story" && !e.dead && e.id)
    .filter((e) => toYmd(new Date(1000 * Number(e.date ?? e.time))) === ymd)
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
}

function decodeEntities(text) {
  return text
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function stripHtml(html) {
  return decodeEntities(
    html
      .replace(/<(p|div|br|li|h[1-6]|tr)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
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
    if (type && !type.includes("html") && !type.includes("text/plain")) return null;
    const html = await res.text();
    const { document } = parseHTML(html);
    const result = await Defuddle(document, url, { markdown: true });
    const text = (result?.content ?? "").trim();
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
    `Points: ${story.points ?? "?"}, comments: ${story.numComments ?? "?"}`,
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

console.log(`Fetching hckrnews stories for ${targetYmd}...`);
const dayStories = await fetchDayStories(targetYmd);
if (dayStories.length === 0) {
  console.error(`No stories found for ${targetYmd}`);
  process.exit(1);
}
const top = dayStories.slice(0, COUNT);
console.log(`${dayStories.length} stories that day; taking top ${top.length} by points`);

const chapters = await mapLimit(top, 3, async (entry, i) => {
  const story = await getJson(`https://hn.algolia.com/api/v1/items/${entry.id}`);
  const title = story.title ?? decodeEntities(entry.link_text ?? "Untitled");
  console.log(`[${i + 1}/${top.length}] (${entry.points} pts) ${title}`);
  const article = story.url ? await fetchArticle(story.url) : stripHtml(story.text ?? "") || null;
  const comments = collectComments(story);
  const text = await summarize(key, { title, url: story.url, points: entry.points, numComments: entry.comments }, article, comments);
  console.log(`[${i + 1}/${top.length}] summarized (${text.split(/\s+/).length} words${article ? "" : ", article unavailable"})`);
  return {
    title,
    text,
    url: story.url ?? `https://news.ycombinator.com/item?id=${entry.id}`,
  };
});

const day = new Date(Number(targetYmd.slice(0, 4)), Number(targetYmd.slice(4, 6)) - 1, Number(targetYmd.slice(6, 8)));
const date = day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const res = await fetch(`${API}/api/books`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    title: `Hacker News Top ${chapters.length} — ${date}`,
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
