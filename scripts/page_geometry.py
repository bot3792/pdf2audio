#!/usr/bin/env python3
"""Page and line geometry for a PDF, in the same frame Marker reports block polygons in
(PDF points, origin top-left, y down), so rects from either source line up."""

import argparse
import json
import os
import sys


def rounded(values):
    return [round(v, 1) for v in values]


def line_geometry(line):
    """Line box, text, and one x edge per character — an exact rect for any character range."""
    chars = [char for span in line["spans"] for char in (span.get("chars") or [])]

    if chars:
        # pdftext reports the line break as characters of its own; it is not part of the line
        while chars and chars[-1]["char"] in "\r\n":
            chars.pop()
        text = "".join(char["char"] for char in chars)
        edges = [round(char["bbox"][0], 1) for char in chars]
        if chars:
            edges.append(round(chars[-1]["bbox"][2], 1))
    else:
        text = "".join(span["text"] for span in line["spans"]).rstrip("\r\n")
        edges = []

    geometry = {"b": rounded(line["bbox"]), "t": text}
    if len(edges) == len(text) + 1:
        geometry["xs"] = edges
    return geometry


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
                lines.append(line_geometry(line))

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
        json.dump({"version": 1, "pages": out}, f, ensure_ascii=False)

    print(json.dumps({"type": "done", "pages": len(out), "lines": sum(len(p["lines"]) for p in out)}), flush=True)


if __name__ == "__main__":
    main()
