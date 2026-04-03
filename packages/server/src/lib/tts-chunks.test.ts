import { describe, expect, it } from "vitest";

import { chunkTextForBulgarianNarrator } from "./tts-chunks.ts";

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

describe("chunkTextForBulgarianNarrator", () => {
  it("keeps a short paragraph as a single chunk", () => {
    const text = "Това е кратък български абзац, който трябва да остане цял и да не бъде разделян.";

    expect(chunkTextForBulgarianNarrator(text)).toEqual([text]);
  });

  it("packs long prose into narrator-sized chunks", () => {
    const text = [
      "Пролетната утрин беше толкова тиха, че човек можеше да чуе как старите дъски на къщата се разтягат под първите лъчи.",
      "Мария стоеше до прозореца и гледаше към градината, където росата блестеше като ситни стъкълца върху тревата.",
      "Тя усещаше, че денят ще донесе нещо важно, макар още да не знаеше дали да се страхува от това чувство, или да му се довери.",
      "В такива сутрини светът изглеждаше почти милостив, сякаш скриваше в себе си възможността човек да започне живота си отново.",
    ].join(" ");

    const chunks = chunkTextForBulgarianNarrator(text);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 320)).toBe(true);
    expect(chunks.every((chunk) => chunk.length >= 120)).toBe(true);
    expect(normalize(chunks.join(" "))).toBe(normalize(text));
  });

  it("falls back to splitting a long sentence by words", () => {
    const text = "Това е много дълго изречение без естествена пауза ".repeat(18).trim();

    const chunks = chunkTextForBulgarianNarrator(text);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 320)).toBe(true);
    expect(normalize(chunks.join(" "))).toBe(normalize(text));
  });
});
