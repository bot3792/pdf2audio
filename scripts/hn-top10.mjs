#!/usr/bin/env node
// Builds a podcast-style audiobook from a day's top Hacker News stories via the
// external API (docs/synthetic-books-api.md). Stories come from hckrnews.com's
// per-day archives, so any past day works, not just what's on the HN front page.
//
// Usage: node scripts/hn-top10.mjs [--date 2026-08-09 | --from 2026-08-04 --to 2026-08-08]
//                                  [--count 10] [--per-day] [--concurrency 5] [--synthesize]
//                                  [--folder "hackernews-summaries"] [--profile <uuid>] [--list]
//                                  [--api http://localhost:3034] [--model deepseek-v4-flash]
// A range picks the overall top --count across all its days (catch-up mode);
// --per-day instead takes the top --count of each day, in day order.
// --list prints the selected stories and exits (no AI calls, no book).
// --folder files the book into that folder by name, creating it if needed.
// Also runnable from the web UI ("HN digest" on the home page), which streams this
// script's output via GET /scripts/hn-top10/stream.
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
const PROFILE = opt("--profile", null);
const apiHeaders = { "Content-Type": "application/json", ...(PROFILE ? { "x-profile-id": PROFILE } : {}) };

const ARTICLE_CAP = 12_000;
const COMMENTS_CAP = 6_000;

const toYmdUtc = (d) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
const ymdToUtcMs = (ymd) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)));

const PER_DAY = flag("--per-day");
const CONCURRENCY = Math.max(1, Number(opt("--concurrency", "5")) || 5);
const dateArg = opt("--date", null);
const fromYmd = (opt("--from", null) ?? dateArg ?? toYmdUtc(new Date())).replaceAll("-", "");
const toYmd = (opt("--to", null) ?? dateArg ?? fromYmd).replaceAll("-", "");
if (!/^\d{8}$/.test(fromYmd) || !/^\d{8}$/.test(toYmd) || ymdToUtcMs(fromYmd) > ymdToUtcMs(toYmd)) {
  console.error(`Invalid date range ${fromYmd}..${toYmd} — use YYYY-MM-DD, from <= to`);
  process.exit(1);
}
const days = [];
for (let t = ymdToUtcMs(fromYmd); t <= ymdToUtcMs(toYmd); t += 86_400_000) days.push(toYmdUtc(new Date(t)));
if (days.length > 90) {
  console.error(`Range spans ${days.length} days — 90 is the maximum`);
  process.exit(1);
}
const dayLabel = (ymd) =>
  new Date(ymdToUtcMs(ymd)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

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

// hckrnews groups stories into UTC days of its crawl timestamp (`date`), and its
// "top 10" tab shows each group's top 10 by points. Archived days live at
// /data/YYYYMMDD.js (`var entries = [...]` JS) — one file IS one day group.
// Recent days aren't archived yet, so their group is reconstructed from
// latest.js (a rolling window) plus the server-rendered homepage (which still
// carries older entries with points and data-date), cut by UTC date.
async function fetchDayStories(ymd) {
  const byId = new Map();

  const archive = await fetch(`https://hckrnews.com/data/${ymd}.js`, { signal: AbortSignal.timeout(30_000) });
  if (archive.ok) {
    const body = await archive.text();
    const entries = JSON.parse(body.replace(/^\s*var\s+entries\s*=\s*/, "").replace(/;\s*$/, ""));
    for (const entry of entries) byId.set(String(entry.id), entry);
  } else {
    const latest = await fetch("https://hckrnews.com/data/latest.js", { signal: AbortSignal.timeout(30_000) });
    if (latest.ok) {
      const body = await latest.text();
      const entries = JSON.parse(body.replace(/^\s*var\s+entries\s*=\s*/, "").replace(/;\s*$/, ""));
      for (const entry of entries) byId.set(String(entry.id), entry);
    }
    const home = await fetch("https://hckrnews.com/", { signal: AbortSignal.timeout(30_000) });
    if (home.ok) {
      const { document } = parseHTML(await home.text());
      for (const li of document.querySelectorAll("li.entry")) {
        const hn = li.querySelector("a.hn");
        const link = li.querySelector("a.link");
        if (!li.id || !hn?.classList.contains("story")) continue;
        byId.set(String(li.id), {
          id: li.id,
          type: "story",
          dead: false,
          date: Number(hn.getAttribute("data-date")),
          points: Number(li.querySelector(".points")?.textContent) || 0,
          comments: Number(li.querySelector(".comments")?.textContent) || 0,
          link: link?.getAttribute("href"),
          link_text: link?.childNodes[0]?.textContent?.trim() ?? "",
        });
      }
    }
    if (byId.size === 0) throw new Error(`hckrnews has no data for ${ymd}`);
    for (const [id, entry] of byId) {
      if (toYmdUtc(new Date(1000 * Number(entry.date ?? entry.time))) !== ymd) byId.delete(id);
    }
  }

  return [...byId.values()]
    .filter((e) => e.type === "story" && !e.dead && e.id)
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
    story.day ? `Story day: ${story.day} (mention the timing only if it matters)` : "",
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

console.log(`Fetching hckrnews stories for ${days.length === 1 ? days[0] : `${days[0]}..${days.at(-1)}`}...`);
const byDay = [];
for (const ymd of days) {
  try {
    const stories = await fetchDayStories(ymd);
    byDay.push({ ymd, stories });
    if (days.length > 1) console.log(`  ${ymd}: ${stories.length} stories`);
  } catch (err) {
    console.log(`  ${ymd}: skipped (${err instanceof Error ? err.message : err})`);
  }
}
const all = byDay.flatMap(({ ymd, stories }) => stories.map((s) => ({ ...s, ymd })));
if (all.length === 0) {
  console.error("No stories found in the range");
  process.exit(1);
}

const picked = PER_DAY
  ? byDay.flatMap(({ ymd, stories }) => stories.slice(0, COUNT).map((s) => ({ ...s, ymd })))
  : [...all].sort((a, b) => (b.points ?? 0) - (a.points ?? 0)).slice(0, COUNT);
const seen = new Set();
const top = picked.filter((e) => !seen.has(String(e.id)) && seen.add(String(e.id)));
console.log(
  `${all.length} stories in ${days.length} day${days.length === 1 ? "" : "s"}; taking ${top.length} (${
    PER_DAY ? `top ${COUNT} per day` : `overall top ${COUNT}`
  })`,
);

if (flag("--list")) {
  for (const [i, e] of top.entries()) {
    const day = days.length > 1 ? `${dayLabel(e.ymd).padEnd(7)} ` : "";
    console.log(`${String(i + 1).padStart(2)}. ${day}${String(e.points).padStart(4)} pts  ${decodeEntities(e.link_text ?? "")}  (${e.link})`);
  }
  process.exit(0);
}

const key = deepseekKey();

const folderName = opt("--folder", null);
let folderId;
if (folderName) {
  const listedRes = await fetch(`${API}/trpc/folders.list`, { headers: apiHeaders, signal: AbortSignal.timeout(30_000) });
  if (!listedRes.ok) throw new Error(`folders.list -> HTTP ${listedRes.status}`);
  const listed = await listedRes.json();
  const existing = (listed.result?.data ?? []).find((f) => f.name === folderName && !f.parentId);
  if (existing) {
    folderId = existing.id;
  } else {
    const created = await fetch(`${API}/trpc/folders.create`, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({ name: folderName }),
    });
    if (!created.ok) throw new Error(`Failed to create folder "${folderName}": HTTP ${created.status}`);
    folderId = (await created.json()).result?.data?.id;
  }
  console.log(`Filing into folder "${folderName}" (${folderId})`);
}

const chapters = (await mapLimit(top, CONCURRENCY, async (entry, i) => {
  const tag = `[${i + 1}/${top.length}]`;
  try {
    const story = await getJson(`https://hn.algolia.com/api/v1/items/${entry.id}`);
    const title = story.title ?? decodeEntities(entry.link_text ?? "Untitled");
    console.log(`${tag} (${entry.points} pts) ${title}`);
    const article = story.url ? await fetchArticle(story.url) : stripHtml(story.text ?? "") || null;
    const comments = collectComments(story);
    const text = await summarize(
      key,
      { title, url: story.url, day: days.length > 1 ? dayLabel(entry.ymd) : undefined, points: entry.points, numComments: entry.comments },
      article,
      comments,
    );
    console.log(`${tag} summarized (${text.split(/\s+/).length} words${article ? "" : ", article unavailable"})`);
    return {
      title: days.length > 1 ? `${dayLabel(entry.ymd)}: ${title}` : title,
      text,
      url: story.url ?? `https://news.ycombinator.com/item?id=${entry.id}`,
    };
  } catch (err) {
    console.log(`${tag} FAILED (${err instanceof Error ? err.message : err}) — skipping "${decodeEntities(entry.link_text ?? "")}"`);
    return null;
  }
})).filter(Boolean);
if (chapters.length === 0) {
  console.error("Every story failed — no book created");
  process.exit(1);
}
if (chapters.length < top.length) console.log(`${top.length - chapters.length} of ${top.length} stories failed and were skipped`);

const rangeLabel = days.length === 1
  ? new Date(ymdToUtcMs(days[0])).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
  : `${dayLabel(days[0])} – ${dayLabel(days.at(-1))}, ${days.at(-1).slice(0, 4)}`;
const res = await fetch(`${API}/api/books`, {
  method: "POST",
  headers: apiHeaders,
  body: JSON.stringify({
    title: `Hacker News Top ${PER_DAY && days.length > 1 ? `${COUNT}/day` : chapters.length} — ${rangeLabel}`,
    client: "hn-top10",
    ...(folderId ? { folderId } : {}),
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
