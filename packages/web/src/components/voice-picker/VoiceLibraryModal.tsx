import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  cartesiaVoiceToEntry,
  languageLabel,
  MULTILINGUAL,
  pocketCustomVoiceToEntry,
  pocketVoiceToEntry,
  sayVoiceToEntry,
  staticVoices,
  type Voice,
  type VoiceEngine,
} from "../../lib/voices.ts";
import { trpc } from "../../trpc.ts";
import { useBodyScrollLock } from "../../lib/use-body-scroll-lock.ts";
import { PocketLanguageNotice } from "./PocketLanguageNotice.tsx";
import { PocketVoiceCloner } from "./PocketVoiceCloner.tsx";
import { VoiceRow } from "./VoiceRow.tsx";
import { Empty, Section } from "./layout.tsx";
import { useVoicePicker } from "./context.tsx";

const CLONED = "cloned";

const ENGINE_LABELS: Record<VoiceEngine, string> = {
  kokoro: "Kokoro",
  pocket: "Pocket TTS",
  narrators: "Other local models",
  say: "macOS system voices",
  cartesia: "Cartesia (cloud)",
};

const ENGINE_ORDER: VoiceEngine[] = ["kokoro", "pocket", "narrators", "say", "cartesia"];

// English first, then Bulgarian (the library's other main language), multilingual last, rest by size.
function orderLanguages(counts: Map<string, number>): string[] {
  const rank = (c: string) => (c === "en" ? 0 : c === "bg" ? 1 : c === MULTILINGUAL ? 3 : 2);
  return [...counts.keys()].sort(
    (a, b) => rank(a) - rank(b) || counts.get(b)! - counts.get(a)! || languageLabel(a).localeCompare(languageLabel(b)),
  );
}

export function VoiceLibraryModal({ onClose }: { onClose: () => void }) {
  const { state } = useVoicePicker();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useBodyScrollLock();

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Opened from inside other modals that keep document-level key handlers (ChapterModal closes on
  // Escape and navigates chapters on arrows). Capture-phase + stopImmediatePropagation keeps Escape
  // from closing both; the container's own handler below stops arrows leaking out of the search box.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const { data: sayVoices = [] } = trpc.sayVoices.list.useQuery(undefined, { staleTime: Infinity });
  const { data: cartesiaVoices = [] } = trpc.cartesiaVoices.list.useQuery(undefined, { staleTime: Infinity });
  const { data: pocket, refetch: refetchPocket } = trpc.pocketVoices.list.useQuery(undefined, { staleTime: Infinity });
  const { data: pocketLanguages = [] } = trpc.pocketVoices.languages.useQuery(undefined, {
    refetchInterval: (q) => (q.state.data?.some((l) => l.downloading) ? 1500 : false),
  });
  const deleteCustomVoice = trpc.pocketVoices.deleteCustom.useMutation({ onSuccess: () => void refetchPocket() });

  const clonedVoices = useMemo(() => (pocket?.custom ?? []).map(pocketCustomVoiceToEntry), [pocket]);

  // Pocket ships one checkpoint per language, so its catalogue repeats under each installed one.
  const pocketVoices = useMemo(
    () =>
      pocketLanguages
        .filter((language) => language.installed)
        .flatMap((language) => (pocket?.voices ?? []).map((voice) => pocketVoiceToEntry(voice, language.code))),
    [pocket, pocketLanguages],
  );

  const allVoices = useMemo<Voice[]>(
    () => [...staticVoices, ...sayVoices.map(sayVoiceToEntry), ...cartesiaVoices.map(cartesiaVoiceToEntry), ...pocketVoices],
    [sayVoices, cartesiaVoices, pocketVoices],
  );

  const languageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const voice of allVoices) {
      const code = voice.language ?? "en";
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    // Pocket languages that aren't downloaded still get a row, so they can be requested from here.
    for (const language of pocketLanguages) if (!counts.has(language.code)) counts.set(language.code, 0);
    return counts;
  }, [allVoices, pocketLanguages]);

  const languages = useMemo(() => orderLanguages(languageCounts), [languageCounts]);

  const [chosen, setChosen] = useState<string>(
    () => allVoicesLanguageOf(state.selectedId) ?? "en",
  );
  const language = chosen === CLONED || languages.includes(chosen) ? chosen : (languages[0] ?? "en");

  const matches = useCallback(
    (...fields: (string | undefined)[]) => {
      const needle = query.trim().toLowerCase();
      return !needle || fields.filter(Boolean).join(" ").toLowerCase().includes(needle);
    },
    [query],
  );

  const pocketLanguage = pocketLanguages.find((l) => l.code === language) ?? null;

  const visible = useMemo(() => {
    const pool =
      language === CLONED
        ? clonedVoices
        // A multilingual model reads any language, so it belongs in every list.
        : allVoices.filter((v) => (v.language ?? "en") === language || v.language === MULTILINGUAL);
    return pool.filter((v) => matches(v.label, v.note, ENGINE_LABELS[v.engine ?? "kokoro"]));
  }, [allVoices, clonedVoices, language, matches]);

  const byEngine = useMemo(() => {
    const groups = new Map<VoiceEngine, Voice[]>();
    for (const voice of visible) {
      const engine = voice.engine ?? "kokoro";
      groups.set(engine, [...(groups.get(engine) ?? []), voice]);
    }
    return ENGINE_ORDER.filter((e) => groups.has(e)).map((engine) => ({ engine, voices: groups.get(engine)! }));
  }, [visible]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      data-testid="voice-library-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-library-title"
        className="bg-(--bg-card) rounded-lg shadow-xl w-[92vw] max-w-3xl h-[80vh] max-h-[46rem] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        data-testid="voice-library-modal"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-(--border) shrink-0">
          <h2 id="voice-library-title" className="text-sm font-medium text-(--text-primary)">Choose a voice</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-(--text-faint) hover:text-(--text-tertiary) p-1 rounded focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
            title="Close"
            aria-label="Close voice picker"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          <nav className="w-48 shrink-0 border-r border-(--border) p-2 overflow-y-auto" aria-label="Languages">
            {languages.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setChosen(code)}
                aria-current={code === language ? "page" : undefined}
                className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-md mb-1 text-sm focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
                  code === language ? "bg-(--bg-selected) text-(--text-primary)" : "text-(--text-secondary) hover:bg-(--bg-subtle)"
                }`}
                data-testid={`voice-language-${code}`}
              >
                <span className="truncate">{languageLabel(code)}</span>
                <span className="text-xs text-(--text-faint) tabular-nums">{languageCounts.get(code) || "↓"}</span>
              </button>
            ))}

            {clonedVoices.length > 0 && (
              <button
                type="button"
                onClick={() => setChosen(CLONED)}
                aria-current={language === CLONED ? "page" : undefined}
                className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-md mt-2 pt-3 border-t border-(--border) text-sm focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
                  language === CLONED ? "bg-(--bg-selected) text-(--text-primary)" : "text-(--text-secondary) hover:bg-(--bg-subtle)"
                }`}
                data-testid="voice-language-cloned"
              >
                <span className="truncate">Your voices</span>
                <span className="text-xs text-(--text-faint) tabular-nums">{clonedVoices.length}</span>
              </button>
            )}
          </nav>

          <div className="flex-1 min-w-0 flex flex-col">
            <div className="p-2 border-b border-(--border) shrink-0">
              <input
                ref={searchRef}
                type="search"
                name="voice-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${language === CLONED ? "your voices" : languageLabel(language)} voices…`}
                aria-label="Search voices"
                className="w-full rounded-md border border-(--border-input) bg-(--bg-input) px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                data-testid="voice-search"
              />
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain p-2" data-testid="voice-list">
              {language === CLONED ? (
                <>
                  {visible.map((voice) => (
                    <VoiceRow
                      key={voice.id}
                      voice={voice}
                      action={
                        <button
                          type="button"
                          onClick={() => deleteCustomVoice.mutate({ id: voice.id.slice("pocket:custom:".length) })}
                          disabled={deleteCustomVoice.isPending}
                          title={`Delete ${voice.label}`}
                          aria-label={`Delete ${voice.label}`}
                          className="shrink-0 px-2 py-1 text-xs text-(--text-faint) hover:text-red-600 disabled:opacity-50 rounded focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                          data-testid={`pocket-delete-${voice.id}`}
                        >
                          Delete
                        </button>
                      }
                    />
                  ))}
                  {pocket?.cloningAvailable ? (
                    <PocketVoiceCloner onAdded={() => void refetchPocket()} />
                  ) : (
                    <p className="px-3 py-2 text-xs text-(--text-muted)">
                      Voice cloning unavailable — accept the terms at huggingface.co/kyutai/pocket-tts, set HF_TOKEN
                      in .env, then re-run <code>pnpm run setup</code>.
                    </p>
                  )}
                </>
              ) : (
                <>
                  {pocketLanguage && !pocketLanguage.installed && <PocketLanguageNotice language={pocketLanguage} />}

                  {byEngine.length > 0
                    ? byEngine.map(({ engine, voices }) => (
                        <Section key={engine} label={`${ENGINE_LABELS[engine]} · ${voices.length}`}>
                          {voices.map((voice) => <VoiceRow key={voice.id} voice={voice} />)}
                        </Section>
                      ))
                    : !pocketLanguage && (
                        <Empty>
                          {query ? (
                            `No ${languageLabel(language)} voices match “${query}”.`
                          ) : (
                            <>
                              No {languageLabel(language)} voices installed.
                              {cartesiaVoices.length === 0 && " Cartesia's cloud catalogue covers most languages — set CARTESIA_API_KEY in .env to list it here."}
                            </>
                          )}
                        </Empty>
                      )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-(--border) shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm font-medium border border-(--border-input) text-(--text-secondary) hover:bg-(--bg-subtle) focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
            data-testid="voice-library-done"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// Opens on the language of the current selection so the picker lands where the user already is.
function allVoicesLanguageOf(voiceId: string): string | null {
  if (voiceId.startsWith("pocket:custom:")) return CLONED;
  const known = staticVoices.find((v) => v.id === voiceId);
  if (known?.language) return known.language;
  if (voiceId.startsWith("pocket:")) {
    const rest = voiceId.slice("pocket:".length);
    const separator = rest.indexOf(":");
    return separator === -1 ? "en" : rest.slice(0, separator);
  }
  return null;
}
