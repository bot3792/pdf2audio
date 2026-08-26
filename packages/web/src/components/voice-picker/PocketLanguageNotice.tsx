import { trpc } from "../../trpc.ts";
import { DownloadNotice } from "../DownloadNotice.tsx";

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
    <DownloadNotice
      className="mx-1 mb-3"
      testIdPrefix="pocket-language"
      settledLabel={language.label}
      buttonLabel={`Download ${language.label} (${language.approxMb} MB)`}
      downloading={language.downloading}
      disabled={download.isPending}
      error={language.error}
      onDownload={() => download.mutate({ code: language.code })}
    >
      <p className="text-(--text-secondary)">
        <strong>Pocket TTS</strong> can read {language.label}, but its model isn't downloaded — about{" "}
        <strong>{language.approxMb} MB</strong>, once. Roughly {language.realtimeFactor}x realtime on the CPU.
      </p>
      {language.note && <p className="text-(--text-muted)">{language.note}</p>}
    </DownloadNotice>
  );
}
