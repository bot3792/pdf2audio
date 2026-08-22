import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  cartesiaVoiceToEntry,
  engineForVoiceId,
  kokoroVoiceGroups,
  narratorVoices,
  sayVoiceToEntry,
  type Voice,
  type VoiceEngine,
  type VoiceGroup,
} from "../../lib/voices.ts";
import { trpc } from "../../trpc.ts";
import { useBodyScrollLock } from "../../lib/use-body-scroll-lock.ts";
import { PocketTab } from "./PocketTab.tsx";
import { VoiceRow } from "./VoiceRow.tsx";
import { Empty, Section } from "./layout.tsx";
import { useVoicePicker } from "./context.tsx";

const TABS: { id: VoiceEngine; label: string; hint: string }[] = [
  { id: "kokoro", label: "Kokoro", hint: "Local · 9 languages" },
  { id: "narrators", label: "Other models", hint: "Local · Bulgarian" },
  { id: "say", label: "macOS", hint: "System voices" },
  { id: "cartesia", label: "Cartesia", hint: "Cloud API" },
  { id: "pocket", label: "Pocket TTS", hint: "Local · cloning" },
];

const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], { type: "language" });
const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

function groupByLanguage(entries: { label: string; voice: Voice }[]): VoiceGroup[] {
  const byLanguage = new Map<string, Voice[]>();
  for (const { label, voice } of entries) {
    const bucket = byLanguage.get(label);
    if (bucket) bucket.push(voice);
    else byLanguage.set(label, [voice]);
  }
  return [...byLanguage.entries()]
    .map(([label, voices]) => ({ label, voices: voices.sort((a, b) => a.label.localeCompare(b.label)) }))
    .sort((a, b) => {
      const aBg = a.label.startsWith("Bulgarian") ? 0 : 1;
      const bBg = b.label.startsWith("Bulgarian") ? 0 : 1;
      return aBg - bBg || a.label.localeCompare(b.label);
    });
}

function localeDisplayName(locale: string): string {
  const [lang, region] = locale.split(/[_-]/);
  try {
    const langName = LANGUAGE_NAMES.of(lang) ?? lang;
    if (!region) return langName;
    const regionName = /^[A-Za-z]{2}$/.test(region)
      ? REGION_NAMES.of(region.toUpperCase()) ?? region
      : region[0].toUpperCase() + region.slice(1);
    return `${langName} (${regionName})`;
  } catch {
    return locale;
  }
}

export function VoiceLibraryModal({ onClose }: { onClose: () => void }) {
  const { state } = useVoicePicker();
  const [tab, setTab] = useState<VoiceEngine>(() => engineForVoiceId(state.selectedId));
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

  const matches = useCallback((label: string, note?: string) => {
    const needle = query.trim().toLowerCase();
    return !needle || `${label} ${note ?? ""}`.toLowerCase().includes(needle);
  }, [query]);

  const { data: sayVoices = [], isLoading: sayLoading } = trpc.sayVoices.list.useQuery(undefined, { staleTime: Infinity, enabled: tab === "say" });
  const { data: cartesiaVoices = [], isLoading: cartesiaLoading } = trpc.cartesiaVoices.list.useQuery(undefined, { staleTime: Infinity, enabled: tab === "cartesia" });

  const sayGroups = useMemo(
    () => groupByLanguage(sayVoices.map((v) => ({ label: localeDisplayName(v.locale), voice: sayVoiceToEntry(v) }))),
    [sayVoices],
  );
  const cartesiaGroups = useMemo(
    () => groupByLanguage(cartesiaVoices.map((v) => ({ label: localeDisplayName(v.language), voice: cartesiaVoiceToEntry(v) }))),
    [cartesiaVoices],
  );

  const renderGroups = (groups: VoiceGroup[], { loading = false, empty }: { loading?: boolean; empty: React.ReactNode }) => {
    if (loading) return <Empty>Loading voices…</Empty>;
    // Group labels are language names — searching "french" has to find the French section, not just
    // voices that happen to have "french" in their own name.
    const filtered = groups
      .map((group) => (matches(group.label) ? group : { ...group, voices: group.voices.filter((v) => matches(v.label, v.note)) }))
      .filter((group) => group.voices.length > 0);
    if (filtered.length === 0) return <Empty>{query ? `No voices match “${query}”.` : empty}</Empty>;
    return filtered.map((group) => (
      <Section key={group.label} label={group.label ? `${group.label} · ${group.voices.length}` : `${group.voices.length} voices`}>
        {group.voices.map((voice) => <VoiceRow key={voice.id} voice={voice} />)}
      </Section>
    ));
  };

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
          <nav className="w-44 shrink-0 border-r border-(--border) p-2 overflow-y-auto" aria-label="Voice engines">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                aria-current={tab === entry.id ? "page" : undefined}
                className={`w-full text-left px-3 py-2 rounded-md mb-1 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
                  tab === entry.id ? "bg-(--bg-selected) text-(--text-primary)" : "text-(--text-secondary) hover:bg-(--bg-subtle)"
                }`}
                data-testid={`voice-tab-${entry.id}`}
              >
                <div className="text-sm">{entry.label}</div>
                <div className="text-xs text-(--text-faint)">{entry.hint}</div>
              </button>
            ))}
          </nav>

          <div className="flex-1 min-w-0 flex flex-col">
            <div className="p-2 border-b border-(--border) shrink-0">
              <input
                ref={searchRef}
                type="search"
                name="voice-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search voices…"
                aria-label="Search voices"
                className="w-full rounded-md border border-(--border-input) bg-(--bg-input) px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                data-testid="voice-search"
              />
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain p-2" data-testid="voice-list">
              {tab === "kokoro" && renderGroups(kokoroVoiceGroups, { empty: "No Kokoro voices." })}
              {tab === "narrators" && renderGroups([{ label: "", voices: narratorVoices }], { empty: "No narrator models." })}
              {tab === "say" && renderGroups(sayGroups, { loading: sayLoading, empty: "No macOS system voices available." })}
              {tab === "cartesia" && renderGroups(cartesiaGroups, { loading: cartesiaLoading, empty: "No Cartesia voices — set CARTESIA_API_KEY in .env and restart the server." })}
              {tab === "pocket" && <PocketTab query={query} matches={matches} />}
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
