#!/usr/bin/env python3
"""Page and line geometry for a PDF, in the same frame Marker reports block polygons in
(PDF points, origin top-left, y down), so rects from either source line up."""

import argparse
import json
import os
import sys


def rounded(values):
    return [round(v, 1) for v in values]


# A printed row runs left to right, so only a wrap sends x backwards; per-character y wobbles
# by a point either way even inside one row, which is why the split reads x and not y.
WRAP_SLACK = 2.0


def split_rows(chars):
    """pdftext sometimes reports two printed rows as one line, giving every word past the wrap
    the row above's y. Their characters carry their own coordinates, so the rows are recoverable."""
    rows = []
    current = []
    for char in chars:
        if current and char["bbox"][0] < current[-1]["bbox"][0] - WRAP_SLACK:
            rows.append(current)
            current = []
        current.append(char)
    if current:
        rows.append(current)
    return rows


def row_geometry(chars):
    """Row box, text, and one x edge per character — an exact rect for any character range."""
    text = "".join(char["char"] for char in chars)
    edges = [round(char["bbox"][0], 1) for char in chars]
    edges.append(round(chars[-1]["bbox"][2], 1))
    box = [
        min(char["bbox"][0] for char in chars),
        min(char["bbox"][1] for char in chars),
        max(char["bbox"][2] for char in chars),
        max(char["bbox"][3] for char in chars),
    ]
    return {"b": rounded(box), "t": text, "xs": edges}


def line_geometry(line):
    chars = [char for span in line["spans"] for char in (span.get("chars") or [])]
    while chars and chars[-1]["char"] in "\r\n":
        chars.pop()

    if not chars:
        text = "".join(span["text"] for span in line["spans"]).rstrip("\r\n")
        return [{"b": rounded(line["bbox"]), "t": text}] if text else []

    return [row_geometry(row) for row in split_rows(chars) if row]


def main():
    parser = argparse.ArgumentParser(description="Extract page and line geometry from a PDF")
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    import pypdfium2 as pdfium
    from pdftext.extraction import dictionary_output

    doc = pdfium.PdfDocument(args.pdf)
    pages = dictionary_output(args.pdf, keep_chars=True)

    out = []
    for index, page in enumerate(pages):
        width, height = page["width"], page["height"]
        pdf_page = doc[index]
        crop = pdf_page.get_cropbox()
        media = pdf_page.get_mediabox()
        # PDF boxes are origin bottom-left; report the crop offset in the top-left frame
        offset = [round(crop[0] - media[0], 1), round(media[3] - crop[3], 1)]

        lines = []
        for block in page["blocks"]:
            for line in block["lines"]:
                lines.extend(line_geometry(line))

        out.append({
            "i": index,
            "w": round(width, 1),
            "h": round(height, 1),
            "rot": pdf_page.get_rotation(),
            "cropOffset": offset,
            "lines": lines,
        })

    doc.close()
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"version": 2, "pages": out}, f, ensure_ascii=False)

    print(json.dumps({"type": "done", "pages": len(out), "lines": sum(len(p["lines"]) for p in out)}), flush=True)


if __name__ == "__main__":
    main()
