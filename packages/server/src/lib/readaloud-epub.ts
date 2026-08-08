import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { SyncMap } from "./sync-map.ts";

const execFileAsync = promisify(execFile);

export type ReadaloudChapter = {
  index: number;
  title: string;
  audioPath: string;
  sync: SyncMap;
};

const LANGUAGE_CODES: Record<string, string> = {
  english: "en", bulgarian: "bg", german: "de", french: "fr", spanish: "es",
  italian: "it", portuguese: "pt", russian: "ru", greek: "el", romanian: "ro",
  polish: "pl", czech: "cs", dutch: "nl", hungarian: "hu", swedish: "sv",
  danish: "da", finnish: "fi", norwegian: "no", turkish: "tr", ukrainian: "uk",
  serbian: "sr", croatian: "hr", slovak: "sk", slovenian: "sl", macedonian: "mk",
};

export function languageCode(language: string | null): string {
  if (!language) return "en";
  return LANGUAGE_CODES[language.trim().toLowerCase()] ?? "und";
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Clock format as in the IDPF media-overlays sample (the shape reader apps are tested against)
function clock(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const frac = Math.round(ms % 1000);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(frac).padStart(3, "0")}`;
}

function chapterBase(seq: number): string {
  return `ch${String(seq).padStart(3, "0")}`;
}

// Layout mirrors the IDPF sample: XHTML and SMIL at the package root, audio in audio/ —
// SMIL audio refs never contain "../", which trips some readers' native path handling.
function chapterXhtml(base: string, title: string, sync: SyncMap, lang: string): string {
  const paragraphs = sync.chunks
    .map((c, i) => `    <p><span id="${base}-s${i}">${esc(c.text)}</span></p>`)
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head>
  <title>${esc(title)}</title>
  <link rel="stylesheet" type="text/css" href="css/style.css"/>
</head>
<body>
  <section epub:type="bodymatter chapter">
    <h1>${esc(title)}</h1>
${paragraphs}
  </section>
</body>
</html>
`;
}

function chapterSmil(base: string, sync: SyncMap): string {
  const pars = sync.chunks
    .map((c, i) => `      <par id="${base}-s${i}">
        <text src="${base}.xhtml#${base}-s${i}"/>
        <audio src="audio/${base}.mp3" clipBegin="${clock(c.startMs)}" clipEnd="${clock(c.endMs)}"/>
      </par>`)
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body>
    <seq id="${base}_overlay_seq" epub:textref="${base}.xhtml" epub:type="bodymatter chapter">
${pars}
    </seq>
  </body>
</smil>
`;
}

function titlepageXhtml(title: string, lang: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head>
  <title>${esc(title)}</title>
  <link rel="stylesheet" type="text/css" href="css/style.css"/>
</head>
<body>
  <section epub:type="frontmatter titlepage">
    <h1>${esc(title)}</h1>
  </section>
</body>
</html>
`;
}

// The Storyteller iOS app (BookService.swift getLocatorFor) subscripts readingOrder one past
// the current chapter without a bounds check — if the LAST spine item has a media overlay,
// every download crashes with SIGTRAP. A trailing non-overlaid page sidesteps it.
function colophonXhtml(lang: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head>
  <title>Colophon</title>
  <link rel="stylesheet" type="text/css" href="css/style.css"/>
</head>
<body>
  <section epub:type="backmatter colophon">
    <p>Produced with pdf2audio.</p>
  </section>
</body>
</html>
`;
}

function navXhtml(title: string, chapters: { base: string; title: string }[], lang: string): string {
  const items = chapters
    .map((ch) => `      <li><a href="${ch.base}.xhtml">${esc(ch.title)}</a></li>`)
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><title>${esc(title)}</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>${esc(title)}</h1>
    <ol>
${items}
    </ol>
  </nav>
</body>
</html>
`;
}

const STYLE_CSS = `body { font-family: serif; line-height: 1.6; margin: 1em; }
h1 { font-size: 1.4em; }
p { margin: 0 0 0.9em 0; }
.-epub-media-overlay-active {
  background-color: #ffb;
}
`;

// Solid-color cover with the title; skipped silently if ffmpeg drawtext is unavailable
async function generateCover(coverPath: string, title: string): Promise<boolean> {
  const text = title.replace(/[\\':]/g, " ").slice(0, 80);
  try {
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi",
      "-i", "color=c=0x1f3a5f:s=600x900",
      "-vf", `drawtext=text='${text}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2:font=Georgia`,
      "-frames:v", "1", coverPath,
    ], { timeout: 60_000 });
    return true;
  } catch {
    try {
      await execFileAsync("ffmpeg", [
        "-y", "-f", "lavfi", "-i", "color=c=0x1f3a5f:s=600x900", "-frames:v", "1", coverPath,
      ], { timeout: 60_000 });
      return true;
    } catch {
      return false;
    }
  }
}

function packageOpf(opts: {
  title: string;
  lang: string;
  hasCover: boolean;
  chapters: { base: string; title: string; sync: SyncMap }[];
}): string {
  const { title, lang, hasCover, chapters } = opts;
  const totalMs = chapters.reduce((sum, ch) => sum + ch.sync.totalMs, 0);
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const manifest = chapters
    .map((ch) => `    <item id="${ch.base}" href="${ch.base}.xhtml" media-type="application/xhtml+xml" media-overlay="${ch.base}_overlay"/>
    <item id="${ch.base}_overlay" href="${ch.base}_overlay.smil" media-type="application/smil+xml"/>
    <item id="audio_${ch.base}" href="audio/${ch.base}.mp3" media-type="audio/mpeg"/>`)
    .join("\n");
  const durations = chapters
    .map((ch) => `    <meta property="media:duration" refines="#${ch.base}_overlay">${clock(ch.sync.totalMs)}</meta>`)
    .join("\n");
  const spine = chapters.map((ch) => `    <itemref linear="yes" idref="${ch.base}"/>`).join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" xml:lang="${lang}" unique-identifier="uid" prefix="media: http://www.idpf.org/epub/vocab/overlays/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:${randomUUID()}</dc:identifier>
    <dc:title id="title">${esc(title)}</dc:title>
    <meta refines="#title" property="title-type">main</meta>
    <dc:creator id="creator">pdf2audio</dc:creator>
    <meta refines="#creator" property="role" scheme="marc:relators">aut</meta>
    <dc:language>${lang}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
${durations}
    <meta property="media:duration">${clock(totalMs)}</meta>
    <meta property="media:active-class">-epub-media-overlay-active</meta>
  </metadata>
  <manifest>
    <item id="nav" properties="nav" href="nav.xhtml" media-type="application/xhtml+xml"/>
    <item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml"/>
    <item id="colophon" href="colophon.xhtml" media-type="application/xhtml+xml"/>
${hasCover ? `    <item id="cover-image" properties="cover-image" href="images/cover.jpg" media-type="image/jpeg"/>\n` : ""}    <item id="style" href="css/style.css" media-type="text/css"/>
${manifest}
  </manifest>
  <spine>
    <itemref linear="yes" idref="titlepage"/>
${spine}
    <itemref linear="yes" idref="colophon"/>
  </spine>
</package>
`;
}

export async function buildReadaloudEpub(opts: {
  title: string;
  language: string | null;
  chapters: ReadaloudChapter[];
  stagingDir: string;
  outputPath: string;
}): Promise<void> {
  const { title, language, chapters, stagingDir, outputPath } = opts;
  if (chapters.length === 0) throw new Error("No chapters to export");
  const lang = languageCode(language);

  const ordered = [...chapters].sort((a, b) => a.index - b.index);
  const named = ordered.map((ch, seq) => ({ ...ch, base: chapterBase(seq) }));

  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(path.join(stagingDir, "META-INF"), { recursive: true });
  for (const dir of ["audio", "css", "images"]) {
    await mkdir(path.join(stagingDir, "OEBPS", dir), { recursive: true });
  }

  const hasCover = await generateCover(path.join(stagingDir, "OEBPS", "images", "cover.jpg"), title);
  if (!hasCover) await rm(path.join(stagingDir, "OEBPS", "images"), { recursive: true, force: true });

  await writeFile(path.join(stagingDir, "mimetype"), "application/epub+zip");
  await writeFile(
    path.join(stagingDir, "META-INF", "container.xml"),
    `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`,
  );
  await writeFile(path.join(stagingDir, "OEBPS", "package.opf"), packageOpf({ title, lang, hasCover, chapters: named }));
  await writeFile(path.join(stagingDir, "OEBPS", "nav.xhtml"), navXhtml(title, named, lang));
  await writeFile(path.join(stagingDir, "OEBPS", "titlepage.xhtml"), titlepageXhtml(title, lang));
  await writeFile(path.join(stagingDir, "OEBPS", "colophon.xhtml"), colophonXhtml(lang));
  await writeFile(path.join(stagingDir, "OEBPS", "css", "style.css"), STYLE_CSS);

  for (const ch of named) {
    await writeFile(path.join(stagingDir, "OEBPS", `${ch.base}.xhtml`), chapterXhtml(ch.base, ch.title, ch.sync, lang));
    await writeFile(path.join(stagingDir, "OEBPS", `${ch.base}_overlay.smil`), chapterSmil(ch.base, ch.sync));
    await copyFile(ch.audioPath, path.join(stagingDir, "OEBPS", "audio", `${ch.base}.mp3`));
  }

  // EPUB OCF: mimetype must be first and stored; audio is already compressed, so store it too
  await rm(outputPath, { force: true });
  const zipOpts = { cwd: stagingDir, timeout: 600_000, maxBuffer: 16 * 1024 * 1024 };
  await execFileAsync("zip", ["-X", "-q", "-0", outputPath, "mimetype"], zipOpts);
  await execFileAsync("zip", ["-X", "-q", "-9", "-r", outputPath, "META-INF", "OEBPS", "-x", "OEBPS/audio/*"], zipOpts);
  await execFileAsync("zip", ["-X", "-q", "-0", "-r", outputPath, "OEBPS/audio"], zipOpts);
}
