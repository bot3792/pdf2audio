import { useState, useRef, useCallback } from "react";
import { getVoiceById, normalizeVoiceId, voiceGroups, type Voice } from "../lib/voices.ts";

type VoicePickerProps = {
  value: string;
  onChange: (voice: string) => void;
};

export function VoicePicker({ value, onChange }: VoicePickerProps) {
  const [expanded, setExpanded] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const selectedId = normalizeVoiceId(value);
  const selected = getVoiceById(value);

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

  return (
    <div className="flex-1">
      <label className="block text-sm font-medium text-(--text-secondary) mb-1">Voice</label>
      <button
        type="button"
        onClick={() => {
          if (expanded) stopAudio();
          setExpanded(!expanded);
        }}
        className="w-full flex items-center justify-between rounded-md border border-(--border-input) bg-(--bg-input) px-3 py-2 text-sm shadow-sm hover:border-(--text-faint) focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <span>
          {selected ? `${selected.label} (${selected.gender}) — ${selected.grade}` : value}
        </span>
        <svg
          className={`h-4 w-4 text-(--text-faint) transition-transform ${expanded ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-2 rounded-lg border border-(--border) bg-(--bg-card) shadow-lg max-h-80 overflow-y-auto">
          {voiceGroups.map((group) => (
            <div key={group.label}>
              <div className="sticky top-0 bg-(--bg-subtle) px-3 py-1.5 text-xs font-semibold text-(--text-muted) uppercase tracking-wider border-b border-(--border)">
                {group.label}
              </div>
              {group.voices.map((voice) => (
                <VoiceRow
                  key={voice.id}
                  voice={voice}
                   isSelected={voice.id === selectedId}
                  isPlaying={playingId === voice.id}
                  onPlay={() => playVoice(voice.id)}
                  onSelect={() => {
                    onChange(voice.id);
                    setExpanded(false);
                    stopAudio();
                  }}
                />
              ))}
            </div>
          ))}
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
      className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-blue-50 ${isSelected ? "bg-blue-50" : ""}`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPlay();
        }}
        className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center border border-(--border) hover:border-blue-400 hover:bg-blue-50 transition-colors"
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
          ({voice.gender})
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
