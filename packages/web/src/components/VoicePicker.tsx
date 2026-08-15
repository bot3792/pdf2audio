import { useState, useRef, useCallback, useMemo } from "react";
import {
  cartesiaVoiceToEntry,
  getVoiceLabel,
  kokoroVoiceGroups,
  narratorVoices,
  normalizeVoiceId,
  sayVoiceToEntry,
  voiceGroups,
  type Voice,
  type VoiceGroup,
} from "../lib/voices.ts";
import { trpc } from "../trpc.ts";

type VoicePickerProps = {
  value: string;
  onChange: (voice: string) => void;
  // Renders as a small inline chip (no label) for toolbar use
  compact?: boolean;
  title?: string;
};

type TabId = "kokoro" | "narrators" | "say" | "cartesia";

const TABS: { id: TabId; label: string }[] = [
  { id: "kokoro", label: "Kokoro" },
  { id: "narrators", label: "Other models" },
  { id: "say", label: "macOS" },
  { id: "cartesia", label: "Cartesia" },
];

function tabForVoiceId(voiceId: string): TabId {
  if (voiceId.startsWith("say:")) return "say";
  if (voiceId.startsWith("cartesia:")) return "cartesia";
  if (voiceId.startsWith("bg-") || voiceId.startsWith("kugel:")) return "narrators";
  return "kokoro";
}

function groupByLanguage(entries: { label: string; voice: Voice }[]): VoiceGroup[] {
  const byLanguage = new Map<string, Voice[]>();
  for (const { label, voice } of entries) {
    byLanguage.set(label, [...(byLanguage.get(label) ?? []), voice]);
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
    const langName = new Intl.DisplayNames(["en"], { type: "language" }).of(lang) ?? lang;
    if (!region) return langName;
    const regionName = /^[A-Za-z]{2}$/.test(region)
      ? new Intl.DisplayNames(["en"], { type: "region" }).of(region.toUpperCase()) ?? region
      : region[0].toUpperCase() + region.slice(1);
    return `${langName} (${regionName})`;
  } catch {
    return locale;
  }
}

export function VoicePicker({ value, onChange, compact = false, title }: VoicePickerProps) {
  const [expanded, setExpanded] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(() => tabForVoiceId(normalizeVoiceId(value)));
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const selectedId = normalizeVoiceId(value);

  const { data: sayVoices = [], isLoading: sayLoading } = trpc.sayVoices.list.useQuery(undefined, { staleTime: Infinity });
  const { data: cartesiaVoices = [], isLoading: cartesiaLoading } = trpc.cartesiaVoices.list.useQuery(undefined, { staleTime: Infinity });

  const sayGroups = useMemo<VoiceGroup[]>(
    () => groupByLanguage(sayVoices.map((v) => ({ label: localeDisplayName(v.locale), voice: sayVoiceToEntry(v) }))),
    [sayVoices],
  );

  const cartesiaGroups = useMemo<VoiceGroup[]>(
    () => groupByLanguage(cartesiaVoices.map((v) => ({ label: localeDisplayName(v.language), voice: cartesiaVoiceToEntry(v) }))),
    [cartesiaVoices],
  );

  const selected = useMemo(
    () =>
      voiceGroups.flatMap((g) => g.voices).find((v) => v.id === selectedId) ??
      [...sayGroups, ...cartesiaGroups].flatMap((g) => g.voices).find((v) => v.id === selectedId) ??
      null,
    [selectedId, sayGroups, cartesiaGroups],
  );

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setPlayingId(null);
  }, []);

  const playVoice = useCallback((voiceId: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    if (playingId === voiceId) {
      setPlayingId(null);
      return;
    }

    const audio = new Audio(`/preview/${encodeURIComponent(voiceId)}`);
    audioRef.current = audio;
    setPlayingId(voiceId);

    audio.addEventListener("ended", () => setPlayingId(null));
    audio.addEventListener("error", () => setPlayingId(null));
    audio.play().catch(() => setPlayingId(null));
  }, [playingId]);

  const selectVoice = useCallback((voiceId: string) => {
    onChange(voiceId);
    setExpanded(false);
    stopAudio();
  }, [onChange, stopAudio]);

  const renderRows = (voices: Voice[]) =>
    voices.map((voice) => (
      <VoiceRow
        key={voice.id}
        voice={voice}
        isSelected={voice.id === selectedId}
        isPlaying={playingId === voice.id}
        onPlay={() => playVoice(voice.id)}
        onSelect={() => selectVoice(voice.id)}
      />
    ));

  const renderCollapsibleGroups = (groups: VoiceGroup[], keyPrefix: string) =>
    groups.map((group) => {
      const key = `${keyPrefix}:${group.label}`;
      const open = openGroups[key] ?? (group.label.startsWith("Bulgarian") || group.voices.some((v) => v.id === selectedId));
      return (
        <div key={key}>
          <button
            type="button"
            onClick={() => setOpenGroups((prev) => ({ ...prev, [key]: !open }))}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-(--text-muted) uppercase tracking-wider bg-(--bg-subtle) border-b border-(--border) hover:bg-(--bg-selected)"
            data-testid={`voice-group-${key}`}
          >
            <svg
              className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
            </svg>
            <span className="flex-1 text-left">{group.label}</span>
            <span className="font-normal tabular-nums">{group.voices.length}</span>
          </button>
          {open && renderRows(group.voices)}
        </div>
      );
    });

  const selectedLabel = selected
    ? `${selected.label}${selected.gender ? ` (${selected.gender})` : ""}${compact ? "" : ` — ${selected.grade}`}`
    : getVoiceLabel(value);

  return (
    <div className={compact ? "relative" : "relative flex-1"}>
      {!compact && <label className="block text-sm font-medium text-(--text-secondary) mb-1">Voice</label>}
      <button
        type="button"
        onClick={() => {
          if (expanded) stopAudio();
          else setActiveTab(tabForVoiceId(selectedId));
          setExpanded(!expanded);
        }}
        title={title}
        className={
          compact
            ? "flex items-center gap-1 text-xs px-2 py-1 rounded border border-(--border) text-(--text-tertiary) hover:bg-(--bg-subtle)"
            : "w-full flex items-center justify-between rounded-md border border-(--border-input) bg-(--bg-input) px-3 py-2 text-sm shadow-sm hover:border-(--text-faint) focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        }
        data-testid="voice-picker-trigger"
      >
        <span className={compact ? "truncate max-w-56" : undefined}>{selectedLabel}</span>
        <svg
          className={`h-4 w-4 shrink-0 text-(--text-faint) transition-transform ${expanded ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {expanded && (
        <div
          className={`absolute z-50 left-0 mt-2 rounded-lg border border-(--border) bg-(--bg-card) shadow-lg max-h-96 overflow-y-auto ${
            compact ? "w-96 max-w-[80vw]" : "right-0"
          }`}
        >
          <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2 bg-(--bg-card) border-b border-(--border)" data-testid="voice-picker-tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`text-xs px-3 py-1 rounded-full border font-medium ${
                  activeTab === tab.id
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "border-(--border) text-(--text-secondary) hover:bg-(--bg-subtle)"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "kokoro" &&
            kokoroVoiceGroups.map((group) => (
              <div key={group.label}>
                <div className="px-3 py-1.5 text-xs font-semibold text-(--text-muted) uppercase tracking-wider bg-(--bg-subtle) border-b border-(--border)">
                  {group.label}
                </div>
                {renderRows(group.voices)}
              </div>
            ))}

          {activeTab === "narrators" && renderRows(narratorVoices)}

          {activeTab === "say" && (
            <>
              {sayLoading ? (
                <p className="px-3 py-3 text-sm text-(--text-muted)">Loading system voices...</p>
              ) : sayGroups.length === 0 ? (
                <p className="px-3 py-3 text-sm text-(--text-muted)">No macOS system voices available.</p>
              ) : (
                renderCollapsibleGroups(sayGroups, "say")
              )}
            </>
          )}

          {activeTab === "cartesia" && (
            <>
              {cartesiaLoading ? (
                <p className="px-3 py-3 text-sm text-(--text-muted)">Loading Cartesia voices...</p>
              ) : cartesiaGroups.length === 0 ? (
                <p className="px-3 py-3 text-sm text-(--text-muted)">
                  No Cartesia voices — set CARTESIA_API_KEY in .env and restart the server.
                </p>
              ) : (
                renderCollapsibleGroups(cartesiaGroups, "cartesia")
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function VoiceRow({
  voice,
  isSelected,
  isPlaying,
  onPlay,
  onSelect,
}: {
  voice: Voice;
  isSelected: boolean;
  isPlaying: boolean;
  onPlay: () => void;
  onSelect: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-(--bg-selected) ${isSelected ? "bg-(--bg-selected)" : ""}`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPlay();
        }}
        className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center border border-(--border) hover:border-blue-400 hover:bg-(--bg-selected) transition-colors"
        title={`Preview ${voice.label}`}
      >
        {isPlaying ? (
          <svg className="h-3.5 w-3.5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
            <path d="M5.75 3a.75.75 0 00-.75.75v12.5a.75.75 0 001.5 0V3.75A.75.75 0 005.75 3zM14.25 3a.75.75 0 00-.75.75v12.5a.75.75 0 001.5 0V3.75a.75.75 0 00-.75-.75z" />
          </svg>
        ) : (
          <svg className="h-3.5 w-3.5 text-(--text-muted)" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
          </svg>
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div className="text-sm text-(--text-primary)">{voice.label}</div>
        <div className="text-xs text-(--text-faint)">
          {voice.gender ? `(${voice.gender})` : voice.id.startsWith("say:") ? "System voice" : "Model voice"}
          {voice.note ? ` · ${voice.note}` : ""}
        </div>
      </div>

      <span className="text-xs font-medium text-(--text-muted) tabular-nums">{voice.grade}</span>

      {isSelected && (
        <svg className="h-4 w-4 text-blue-600 shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
        </svg>
      )}
    </div>
  );
}
