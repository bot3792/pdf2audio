import type { CitationCatalog, CitationSource } from "./chat-tools.ts";

export function extractCitationIds(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(/\[(c_\d+)\]/g)) {
    seen.add(match[1]);
  }
  return [...seen];
}

// Hallucinated ids are dropped; the answer text is left untouched
export function verifySources(text: string, catalog: CitationCatalog): CitationSource[] {
  const sources: CitationSource[] = [];
  for (const id of extractCitationIds(text)) {
    const source = catalog.get(id);
    if (source) sources.push(source);
  }
  return sources;
}
