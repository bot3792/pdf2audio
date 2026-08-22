import { trpc } from "../../trpc.ts";

type PocketLanguageState = {
  code: string;
  label: string;
  approxMb: number;
  realtimeFactor: number;
  note?: string | null;
  installed: boolean;
  downloading: boolean;
  error: string | null;
};

export function PocketLanguageNotice({ language }: { language: PocketLanguageState }) {
  const utils = trpc.useUtils();
  const download = trpc.pocketVoices.downloadLanguage.useMutation({
    onSuccess: () => void utils.pocketVoices.languages.invalidate(),
  });

  return (
    <div className="mx-1 mb-3 rounded-md border border-(--border) bg-(--bg-subtle) px-3 py-2 text-xs space-y-1">
      <p className="text-(--text-secondary)">
        <strong>Pocket TTS</strong> can read {language.label}, but its model isn't downloaded — about{" "}
        <strong>{language.approxMb} MB</strong>, once. Roughly {language.realtimeFactor}x realtime on the CPU.
      </p>
      {language.note && <p className="text-(--text-muted)">{language.note}</p>}
      {language.error && <p className="text-red-600" data-testid="pocket-language-error">{language.error}</p>}
      <button
        type="button"
        onClick={() => download.mutate({ code: language.code })}
        disabled={language.downloading || download.isPending}
        className="px-2 py-1 rounded bg-blue-600 text-white disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        data-testid="pocket-language-download"
      >
        {language.downloading ? `Downloading ${language.label}…` : `Download ${language.label} (${language.approxMb} MB)`}
      </button>
      {language.downloading && (
        <p className="text-(--text-muted)">Keep using the app — voices appear here when it lands, no restart.</p>
      )}
    </div>
  );
}
