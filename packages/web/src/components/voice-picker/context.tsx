import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";

type VoicePickerContextValue = {
  state: {
    selectedId: string;
    playingId: string | null;
    /** Synthesizing on the server — the first play of any voice pays for this. */
    pendingId: string | null;
    failedId: string | null;
  };
  actions: { select: (voiceId: string) => void; play: (voiceId: string) => void };
};

const VoicePickerContext = createContext<VoicePickerContextValue | null>(null);

export function useVoicePicker(): VoicePickerContextValue {
  const value = use(VoicePickerContext);
  if (!value) throw new Error("useVoicePicker must be used inside <VoicePickerProvider>");
  return value;
}

const POLL_INTERVAL_MS = 800;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

// A cold preview is synthesized on demand, which on the CPU engines takes seconds. Fetching it
// ourselves (rather than handing the URL to an <audio>) is what lets the row say so — and it is
// also the only way to survive the 202 the server returns while a duplicate request is in flight.
async function fetchPreviewUrl(voiceId: string, signal: AbortSignal): Promise<string> {
  for (;;) {
    const response = await fetch(`/preview/${encodeURIComponent(voiceId)}`, { signal });
    if (response.status === 202) {
      await wait(POLL_INTERVAL_MS, signal);
      continue;
    }
    if (!response.ok) throw new Error(`Preview failed (${response.status})`);
    return URL.createObjectURL(await response.blob());
  }
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
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const teardown = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.remove();
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    teardown();
    setPlayingId(null);
    setPendingId(null);
    setFailedId(null);
  }, [teardown]);

  // Abandoning the modal mid-generation would otherwise leave the poll loop running for good.
  useEffect(() => teardown, [teardown]);

  const play = useCallback((voiceId: string) => {
    // Generation is already under way; further clicks would only restart the wait.
    if (pendingId === voiceId) return;

    const wasPlaying = playingId === voiceId;
    stop();
    if (wasPlaying) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setPendingId(voiceId);

    fetchPreviewUrl(voiceId, controller.signal)
      .then((url) => {
        if (controller.signal.aborted) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrlRef.current = url;
        // Attached so the app-wide exclusive-audio listener sees it; a detached element's
        // "play" never reaches the document, leaving previews to talk over the chapter player.
        const audio = new Audio(url);
        audio.hidden = true;
        document.body.append(audio);
        audioRef.current = audio;
        audio.addEventListener("ended", () => setPlayingId(null));
        audio.addEventListener("error", () => {
          setPlayingId(null);
          setFailedId(voiceId);
        });
        setPendingId(null);
        setPlayingId(voiceId);
        audio.play().catch(() => {
          setPlayingId(null);
          setFailedId(voiceId);
        });
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setPendingId(null);
        setFailedId(voiceId);
      });
  }, [playingId, pendingId, stop]);

  const select = useCallback((voiceId: string) => {
    onSelect(voiceId);
    stop();
  }, [onSelect, stop]);

  const value = useMemo<VoicePickerContextValue>(
    () => ({ state: { selectedId, playingId, pendingId, failedId }, actions: { select, play } }),
    [selectedId, playingId, pendingId, failedId, select, play],
  );

  return <VoicePickerContext value={value}>{children}</VoicePickerContext>;
}
