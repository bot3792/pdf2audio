import { useEffect } from "react";

// The element's own timeupdate fires far too rarely to look like it follows the voice, so the
// position is read every frame — but published at this granularity, since the highlight only ever
// moves on a word boundary. At 60Hz every consumer of it would re-render sixty times a second.
const PUBLISH_MS = 100;

export function useAudioTime(
  audio: React.RefObject<HTMLAudioElement | null>,
  playing: boolean,
  onTime: (ms: number) => void,
): void {
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let published = -1;
    const tick = () => {
      const ms = (audio.current?.currentTime ?? 0) * 1000;
      const step = Math.floor(ms / PUBLISH_MS);
      if (step !== published) {
        published = step;
        onTime(ms);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [audio, playing, onTime]);
}
