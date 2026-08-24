// Regenerates fixtures/tiny-book.pdf — a 3-chapter public-domain-style booklet
// with real headings so both pdftotext raw extraction and marker's SectionHeader
// detection have something to find. Run: pnpm fixtures:pdf

import PDFDocument from "pdfkit";
import { createWriteStream } from "node:fs";
import path from "node:path";

const out = path.join(import.meta.dirname, "tiny-book.pdf");
const doc = new PDFDocument({ size: "A4", margin: 72 });
doc.pipe(createWriteStream(out));

const chapters = [
  {
    title: "Chapter 1. The Voyage Begins",
    body: "The ship left the harbor at dawn, its sails catching the first light of morning. The crew had prepared for months, storing provisions and charting the course south. Nobody aboard knew what the islands held, but the captain kept a steady hand on the wheel and a journal open on the table. Each day brought new entries: winds, currents, and the slow arithmetic of distance.",
  },
  {
    title: "Chapter 2. The Storm",
    body: "On the ninth day the barometer fell sharply. Clouds gathered in a dark wall to the west, and the first gusts tore at the rigging before noon. The crew lashed down everything that could move and reefed the sails to scraps. For two days the ship climbed mountains of water and slid into valleys between them, timbers groaning at every joint. When the sky finally cleared, they counted their luck and their losses in the same breath.",
  },
  {
    title: "Chapter 3. Landfall",
    body: "The island rose from the horizon like a green thumbprint on blue glass. Birds circled the masts as the ship eased into a shallow bay lined with pale sand. The captain closed the journal, finally, on a page that read simply: arrived. What they found ashore — the spring of fresh water, the grove of fruit trees, the strange carved stones — would fill another volume entirely.",
  },
];

for (const [i, chapter] of chapters.entries()) {
  if (i > 0) doc.addPage();
  doc.font("Helvetica-Bold").fontSize(20).text(chapter.title);
  doc.moveDown();
  doc.font("Helvetica").fontSize(12).text(chapter.body, { lineGap: 4 });
  doc.moveDown();
  doc.font("Helvetica").fontSize(12).text(chapter.body, { lineGap: 4 });
}

doc.end();
console.log(`wrote ${out}`);
