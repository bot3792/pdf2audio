import { useBodyScrollLock } from "../lib/use-body-scroll-lock.ts";
import { voiceSupportsSpeedControl } from "../lib/voices.ts";
import { VoicePicker } from "./VoicePicker.tsx";
import { SpeedSlider } from "./SpeedSlider.tsx";

export function SynthesizeModal({
  count,
  language,
  voice,
  speed,
  onChangeVoice,
  onChangeSpeed,
  canStart,
  disabledReason,
  onStart,
  onClose,
}: {
  count: number;
  language: string | null;
  voice: string;
  speed: number;
  onChangeVoice: (voice: string) => void;
  onChangeSpeed: (speed: number) => void;
  canStart: boolean;
  disabledReason?: string;
  onStart: () => void;
  onClose: () => void;
}) {
  useBodyScrollLock();

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-(--bg-card) rounded-lg shadow-xl w-[90vw] max-w-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
        data-testid="synthesize-modal"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-(--border) shrink-0">
          <span className="text-sm font-medium text-(--text-primary)">
            Synthesize {count} chapter{count === 1 ? "" : "s"}{language ? ` · ${language}` : ""}
          </span>
          <button onClick={onClose} className="text-(--text-faint) hover:text-(--text-tertiary) p-1" title="Close">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          <VoicePicker value={voice} onChange={onChangeVoice} />
          <SpeedSlider
            value={speed}
            onChange={onChangeSpeed}
            disabled={!voiceSupportsSpeedControl(voice)}
          />
          <p className="text-xs text-(--text-muted)">
            {language
              ? `Voice and speed are saved for the ${language} variant only — the original and other variants keep their own.`
              : "Voice and speed are saved on the book and apply to the original audio; variants without a voice of their own follow it."}{" "}
            Chapters that already have audio keep it until re-synthesized.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-(--border) shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm font-medium border border-(--border-input) text-(--text-secondary) hover:bg-(--bg-subtle)"
          >
            Cancel
          </button>
          <button
            onClick={onStart}
            disabled={!canStart}
            title={canStart ? undefined : disabledReason}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="start-synthesis"
          >
            Start synthesis ({count})
          </button>
        </div>
      </div>
    </div>
  );
}
