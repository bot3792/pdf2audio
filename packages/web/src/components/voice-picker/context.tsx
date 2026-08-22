import { createContext, use, useCallback, useMemo, useRef, useState } from "react";

type VoicePickerContextValue = {
  state: { selectedId: string; playingId: string | null };
  actions: { select: (voiceId: string) => void; play: (voiceId: string) => void };
};

const VoicePickerContext = createContext<VoicePickerContextValue | null>(null);

export function useVoicePicker(): VoicePickerContextValue {
  const value = use(VoicePickerContext);
  if (!value) throw new Error("useVoicePicker must be used inside <VoicePickerProvider>");
  return value;
}

export function VoicePickerProvider({
  selectedId,
  onSelect,
  children,
}: {
  selectedId: string;
  onSelect: (voiceId: string) => void;
  children: React.ReactNode;
}) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setPlayingId(null);
  }, []);

  const play = useCallback((voiceId: string) => {
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

  const select = useCallback((voiceId: string) => {
    onSelect(voiceId);
    stop();
  }, [onSelect, stop]);

  const value = useMemo<VoicePickerContextValue>(
    () => ({ state: { selectedId, playingId }, actions: { select, play } }),
    [selectedId, playingId, select, play],
  );

  return <VoicePickerContext value={value}>{children}</VoicePickerContext>;
}
