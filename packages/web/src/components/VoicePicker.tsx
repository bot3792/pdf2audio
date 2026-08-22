import { useCallback, useMemo, useRef, useState } from "react";

import {
  cartesiaVoiceToEntry,
  engineForVoiceId,
  getVoiceLabel,
  normalizeVoiceId,
  pocketCustomVoiceToEntry,
  pocketVoiceToEntry,
  sayVoiceToEntry,
  type Voice,
} from "../lib/voices.ts";
import { trpc } from "../trpc.ts";
import { VoicePickerProvider } from "./voice-picker/context.tsx";
import { VoiceLibraryModal } from "./voice-picker/VoiceLibraryModal.tsx";

type VoicePickerProps = {
  value: string;
  onChange: (voice: string) => void;
  title?: string;
};

// Only the engine owning the current selection is queried — the modal loads the rest on demand.
function useSelectedVoiceLabel(selectedId: string): string {
  const engine = engineForVoiceId(selectedId);
  const { data: sayVoices = [] } = trpc.sayVoices.list.useQuery(undefined, { staleTime: Infinity, enabled: engine === "say" });
  const { data: cartesiaVoices = [] } = trpc.cartesiaVoices.list.useQuery(undefined, { staleTime: Infinity, enabled: engine === "cartesia" });
  const { data: pocket } = trpc.pocketVoices.list.useQuery(undefined, { staleTime: Infinity, enabled: engine === "pocket" });

  return useMemo(() => {
    const candidates: Voice[] =
      engine === "say" ? sayVoices.map(sayVoiceToEntry)
      : engine === "cartesia" ? cartesiaVoices.map(cartesiaVoiceToEntry)
      : engine === "pocket" ? [
          ...(pocket?.custom ?? []).map(pocketCustomVoiceToEntry),
          ...(pocket?.voices ?? []).map((voice) => pocketVoiceToEntry(voice, pocketLanguageOf(selectedId))),
        ]
      : [];
    return candidates.find((voice) => voice.id === selectedId)?.label ?? getVoiceLabel(selectedId);
  }, [selectedId, engine, sayVoices, cartesiaVoices, pocket]);
}

// `pocket:it:giovanni` — the middle segment is the language; bare and `custom:` ids are English.
function pocketLanguageOf(voiceId: string): string {
  const rest = voiceId.slice("pocket:".length);
  const separator = rest.indexOf(":");
  if (separator === -1) return "en";
  const code = rest.slice(0, separator);
  return code === "custom" ? "en" : code;
}

function useVoiceLibrary(value: string, onChange: (voice: string) => void) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedId = normalizeVoiceId(value);
  const label = useSelectedVoiceLabel(selectedId);

  const close = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  const library = isOpen ? (
    <VoicePickerProvider selectedId={selectedId} onSelect={onChange}>
      <VoiceLibraryModal onClose={close} />
    </VoicePickerProvider>
  ) : null;

  return { open: () => setIsOpen(true), triggerRef, label, library };
}

const CHEVRON = (
  <svg className="h-4 w-4 text-(--text-faint) shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
  </svg>
);

export function VoicePicker({ value, onChange, title }: VoicePickerProps) {
  const { open, triggerRef, label, library } = useVoiceLibrary(value, onChange);

  return (
    <div className="relative flex-1">
      <label className="block text-sm font-medium text-(--text-secondary) mb-1" htmlFor="voice-picker-trigger">Voice</label>
      <button
        id="voice-picker-trigger"
        ref={triggerRef}
        type="button"
        onClick={open}
        title={title}
        aria-haspopup="dialog"
        className="w-full flex items-center justify-between rounded-md border border-(--border-input) bg-(--bg-input) px-3 py-2 text-sm shadow-sm hover:border-(--text-faint) focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        data-testid="voice-picker-trigger"
      >
        <span className="truncate">{label}</span>
        {CHEVRON}
      </button>
      {library}
    </div>
  );
}

export function VoicePickerChip({ value, onChange, title }: VoicePickerProps) {
  const { open, triggerRef, label, library } = useVoiceLibrary(value, onChange);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        title={title}
        aria-haspopup="dialog"
        aria-label={`Voice: ${label}`}
        className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-(--border) text-(--text-tertiary) hover:bg-(--bg-subtle) focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        data-testid="voice-picker-trigger"
      >
        <span className="truncate max-w-56">{label}</span>
        {CHEVRON}
      </button>
      {library}
    </div>
  );
}
