#!/usr/bin/env python3
import argparse
import json
import os
import re
import subprocess
import sys

os.environ["HF_HUB_OFFLINE"] = "1"

MODEL_ID = "mlx-community/Qwen2.5-1.5B-Instruct-4bit"


def strip_html(html: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html)
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", text).strip()


def extract_heading_level(html: str) -> int:
    match = re.match(r"<h(\d)", html)
    return int(match.group(1)) if match else 4


def collect_headings(children: list[dict], page_num: int, headings: list[dict]):
    for child in children:
        if child.get("block_type") == "SectionHeader":
            html = child.get("html", "")
            text = strip_html(html)
            if text:
                level = extract_heading_level(html)
                hid = f"h_{len(headings) + 1:04d}"
                headings.append({"id": hid, "page": page_num, "level": level, "text": text})
        if child.get("children"):
            collect_headings(child["children"], page_num, headings)


def extract_from_marker_json(doc: dict) -> tuple[list[dict], list[int], str | None, str | None]:
    headings: list[dict] = []
    toc_pages: set[int] = set()
    toc_parts: list[str] = []

    for page_idx, page in enumerate(doc.get("children", []), start=1):
        if page.get("block_type") != "Page" or not page.get("children"):
            continue

        for block in page["children"]:
            block_type = block.get("block_type", "")

            if block_type == "TableOfContents":
                toc_pages.add(page_idx)
                text = strip_html(block.get("html", ""))
                if text:
                    toc_parts.append(text)

            if block_type == "SectionHeader":
                html = block.get("html", "")
                text = strip_html(html)
                if text:
                    level = extract_heading_level(html)
                    hid = f"h_{len(headings) + 1:04d}"
                    headings.append({"id": hid, "page": page_idx, "level": level, "text": text})
            elif block.get("children"):
                collect_headings(block["children"], page_idx, headings)

    metadata_lines: list[str] = []
    toc_meta = (doc.get("metadata") or {}).get("table_of_contents") or []
    for entry in toc_meta:
        title = str(entry.get("title") or "").strip()
        if not title:
            continue
        page = entry.get("page_id")
        level = entry.get("heading_level")
        metadata_lines.append(f"p{page} l{level} {title}")

    toc_blocks_text = "\n".join(toc_parts).strip() or None
    metadata_text = "\n".join(metadata_lines).strip() or None
    return headings, sorted(toc_pages), toc_blocks_text, metadata_text


def extract_pdftext_toc(pdf_path: str | None, toc_pages: list[int]) -> str | None:
    if not pdf_path:
        return None
    if not toc_pages:
        return None

    parts: list[str] = []
    for page in toc_pages:
        try:
            proc = subprocess.run(
                ["pdftotext", pdf_path, "-", "-f", str(page), "-l", str(page)],
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
        except Exception:
            continue

        if proc.returncode != 0:
            continue

        text = re.sub(r"\s+", " ", proc.stdout).strip()
        if len(text) >= 40:
            parts.append(f"p{page} {text}")

    if not parts:
        return None
    return "\n".join(parts)


def build_id_selection_prompt(toc_evidence: str, headings: list[dict]) -> list[dict]:
    heading_lines = [f'{h["id"]} p{h["page"]} l{h["level"]} "{h["text"]}"' for h in headings]
    return [
        {
            "role": "user",
            "content": (
                "You are selecting chapter boundaries from known headings.\n"
                "Use the TABLE OF CONTENTS evidence to choose headings that appear in the TOC order.\n"
                "Include top-level chapters and subtitles/subsections when they appear in the TOC.\n"
                "Include front matter/back matter too if they appear in TOC.\n"
                "Select all matching entries, not only top-level chapters.\n"
                "Do NOT invent headings. Only choose IDs from the heading catalog.\n"
                "Return JSON only in this format: {\"ids\": [\"h_0001\", \"h_0002\"]}\n\n"
                f"TABLE OF CONTENTS EVIDENCE:\n{toc_evidence}\n\n"
                "HEADING CATALOG:\n"
                + "\n".join(heading_lines)
                + "\n\nJSON:"
            ),
        }
    ]


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", " ", text.lower())).strip()


def heading_match_key(text: str) -> str:
    normalized = normalize_text(text)
    normalized = re.sub(r"^(?:[a-z]|\d+|[ivxlcdm]+)\s+", "", normalized)
    words = [w for w in normalized.split() if len(w) >= 3]
    if not words:
        return ""
    return " ".join(words[:4])


def select_candidate_headings(headings: list[dict], toc_evidence: str) -> list[dict]:
    corpus = normalize_text(toc_evidence)
    candidates: list[dict] = []
    for h in headings:
        key = heading_match_key(h["text"])
        if key and key in corpus:
            candidates.append(h)
    if len(candidates) >= 10:
        return candidates
    return headings


def parse_selected_ids(response: str, valid_ids: set[str]) -> list[str]:
    selected: list[str] = []

    try:
        parsed = json.loads(response)
        if isinstance(parsed, dict) and isinstance(parsed.get("ids"), list):
            for item in parsed["ids"]:
                if isinstance(item, str) and item in valid_ids:
                    selected.append(item)
        elif isinstance(parsed, list):
            for item in parsed:
                if isinstance(item, str) and item in valid_ids:
                    selected.append(item)
    except Exception:
        pass

    if not selected:
        for match in re.findall(r"h_\d{4}", response):
            if match in valid_ids:
                selected.append(match)

    deduped: list[str] = []
    seen: set[str] = set()
    for sid in selected:
        if sid in seen:
            continue
        seen.add(sid)
        deduped.append(sid)
    return deduped


def build_boundaries_from_ids(selected_ids: list[str], headings: list[dict]) -> list[dict]:
    heading_by_id = {h["id"]: h for h in headings}
    order_index = {h["id"]: i for i, h in enumerate(headings)}

    valid = [sid for sid in selected_ids if sid in heading_by_id]
    valid.sort(key=lambda sid: order_index[sid])

    boundaries = []
    for sid in valid:
        h = heading_by_id[sid]
        boundaries.append({"title": h["text"], "page": h["page"]})
    return boundaries


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Marker JSON file path")
    parser.add_argument("--pdf", required=False, help="Original PDF path (for pdftotext fallback)")
    args = parser.parse_args()

    with open(args.input) as f:
        doc = json.load(f)

    headings, toc_pages, toc_blocks_text, toc_meta_text = extract_from_marker_json(doc)
    if len(headings) < 2:
        json.dump([], sys.stdout)
        return

    toc_sources: list[str] = []
    evidence_parts: list[str] = []

    if toc_meta_text:
        toc_sources.append("metadata")
        evidence_parts.append("[marker metadata toc]\n" + toc_meta_text)

    if toc_blocks_text:
        toc_sources.append("toc_blocks")
        evidence_parts.append("[marker toc blocks]\n" + toc_blocks_text)

    pdftext_toc = extract_pdftext_toc(args.pdf, toc_pages)
    if pdftext_toc:
        toc_sources.append("pdftext")
        evidence_parts.append("[pdftext toc pages]\n" + pdftext_toc)

    if not evidence_parts:
        print(f"No TOC evidence found, {len(headings)} headings", file=sys.stderr)
        json.dump([], sys.stdout)
        return

    toc_evidence = "\n\n".join(evidence_parts)
    print(f"TOC sources: {', '.join(toc_sources)} | headings: {len(headings)}", file=sys.stderr)

    try:
        from mlx_lm import generate, load
    except ImportError:
        print("mlx-lm not installed", file=sys.stderr)
        json.dump([], sys.stdout)
        return

    print("Loading model...", file=sys.stderr)
    try:
        model, tokenizer = load(MODEL_ID)
    except Exception as err:
        print(f"Failed to load model: {err}", file=sys.stderr)
        json.dump([], sys.stdout)
        return

    candidate_headings = select_candidate_headings(headings, toc_evidence)
    print(f"Candidate headings: {len(candidate_headings)} / {len(headings)}", file=sys.stderr)

    messages = build_id_selection_prompt(toc_evidence, candidate_headings)
    prompt = tokenizer.apply_chat_template(messages, add_generation_prompt=True, tokenize=False)
    print(f"Prompt length: {len(prompt)} chars", file=sys.stderr)

    from mlx_lm.sample_utils import make_sampler

    print("Running inference...", file=sys.stderr)
    response = generate(
        model,
        tokenizer,
        prompt=prompt,
        max_tokens=1536,
        sampler=make_sampler(temp=0.0),
    )

    print(f"Raw response:\n{response}", file=sys.stderr)

    valid_ids = {h["id"] for h in candidate_headings}
    selected_ids = parse_selected_ids(response, valid_ids)
    print(f"Selected ids: {len(selected_ids)}", file=sys.stderr)

    if len(selected_ids) < 2:
        json.dump([], sys.stdout)
        return

    boundaries = build_boundaries_from_ids(selected_ids, headings)
    if len(boundaries) < 2:
        json.dump([], sys.stdout)
        return

    json.dump(boundaries, sys.stdout)
    print(f"Detected {len(boundaries)} boundaries", file=sys.stderr)


if __name__ == "__main__":
    main()
