import { useMemo, useState } from "react";

import { pocketCustomVoiceToEntry, pocketVoiceToEntry, POCKET_CUSTOM_PREFIX } from "../../lib/voices.ts";
import { trpc } from "../../trpc.ts";
import { PocketVoiceCloner } from "./PocketVoiceCloner.tsx";
import { VoiceRow } from "./VoiceRow.tsx";
import { Empty, Section } from "./layout.tsx";

export function PocketTab({ query, matches }: { query: string; matches: (label: string, note?: string) => boolean }) {
  const { data: pocket, isLoading, refetch } = trpc.pocketVoices.list.useQuery(undefined, { staleTime: Infinity });
  const deleteCustomVoice = trpc.pocketVoices.deleteCustom.useMutation({ onSuccess: () => void refetch() });

  const { data: languages = [], refetch: refetchLanguages } = trpc.pocketVoices.languages.useQuery(undefined, {
    // Downloads land in a shared cache the synthesis subprocess reads at spawn time, so polling
    // until one finishes is all that's needed — no server restart.
    refetchInterval: (q) => (q.state.data?.some((l) => l.downloading) ? 1500 : false),
  });
  const download = trpc.pocketVoices.downloadLanguage.useMutation({ onSuccess: () => void refetchLanguages() });

  const [languageCode, setLanguageCode] = useState("en");
  const language = languages.find((l) => l.code === languageCode) ?? null;

  const catalog = useMemo(
    () => (pocket?.voices ?? []).map((voice) => pocketVoiceToEntry(voice, languageCode)),
    [pocket, languageCode],
  );
  const custom = useMemo(() => (pocket?.custom ?? []).map(pocketCustomVoiceToEntry), [pocket]);

  if (isLoading) return <Empty>Loading voices…</Empty>;
  if (!pocket?.installed) {
    return <Empty>Pocket TTS is not installed — run <code>pnpm run setup</code> to create .venv-pocket.</Empty>;
  }

  const visibleCustom = custom.filter((voice) => matches(voice.label, voice.note));
  const visibleCatalog = catalog.filter((voice) => matches(voice.label, voice.note));

  return (
    <>
      <Section label="Language">
        <div className="flex flex-wrap gap-1 px-3 pb-1">
          {languages.map((entry) => (
            <button
              key={entry.code}
              type="button"
              onClick={() => setLanguageCode(entry.code)}
              aria-pressed={entry.code === languageCode}
              title={entry.installed ? `${entry.label} — installed` : `${entry.label} — not downloaded (~${entry.approxMb} MB)`}
              className={`px-2 py-1 text-xs rounded border focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
                entry.code === languageCode
                  ? "border-blue-500 text-blue-600 bg-(--bg-selected)"
                  : "border-(--border) text-(--text-muted) hover:bg-(--bg-subtle)"
              }`}
              data-testid={`pocket-language-${entry.code}`}
            >
              {entry.label}
              {!entry.installed && <span className="ml-1 text-(--text-faint)">↓{entry.approxMb}MB</span>}
            </button>
          ))}
        </div>

        {language && !language.installed && (
          <div className="mx-3 mb-2 rounded-md border border-(--border) bg-(--bg-subtle) px-3 py-2 text-xs space-y-1">
            <p className="text-(--text-secondary)">
              <strong>{language.label}</strong> isn't downloaded yet — about <strong>{language.approxMb} MB</strong>,
              a one-off. It runs at roughly {language.realtimeFactor}x realtime on the CPU.
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
              {language.downloading ? `Downloading ${language.label}…` : `Download ${language.label}`}
            </button>
            {language.downloading && (
              <p className="text-(--text-muted)">
                You can keep using the app — voices appear here when it finishes, no restart needed.
              </p>
            )}
          </div>
        )}

        {language?.installed && language.code !== "en" && (
          <p className="px-3 pb-2 text-xs text-(--text-muted)">
            Voices below read <strong>{language.label}</strong>{language.note ? ` · ${language.note}` : ""}
          </p>
        )}
      </Section>

      {languageCode === "en" && (
        <>
          {visibleCustom.length > 0 && (
            <Section label={`Your voices · ${visibleCustom.length}`}>
              {visibleCustom.map((voice) => (
                <VoiceRow
                  key={voice.id}
                  voice={voice}
                  action={
                    <button
                      type="button"
                      onClick={() => deleteCustomVoice.mutate({ id: voice.id.slice(POCKET_CUSTOM_PREFIX.length) })}
                      disabled={deleteCustomVoice.isPending}
                      title={`Delete ${voice.label}`}
                      aria-label={`Delete ${voice.label}`}
                      className="shrink-0 px-2 py-1 text-xs text-(--text-faint) hover:text-red-600 disabled:opacity-50 rounded focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                      data-testid={`pocket-delete-${voice.id}`}
                    >
                      Delete
                    </button>
                  }
                />
              ))}
            </Section>
          )}

          {pocket.cloningAvailable ? (
            <PocketVoiceCloner onAdded={() => void refetch()} />
          ) : (
            <p className="px-3 py-2 text-xs text-(--text-muted)">
              Voice cloning unavailable — accept the terms at huggingface.co/kyutai/pocket-tts, set HF_TOKEN in .env,
              then re-run <code>pnpm run setup</code>.
            </p>
          )}
        </>
      )}

      {language?.installed !== false && (
        <Section label={`Built-in · ${visibleCatalog.length}`}>
          {visibleCatalog.length === 0
            ? <Empty>No voices match “{query}”.</Empty>
            : visibleCatalog.map((voice) => <VoiceRow key={voice.id} voice={voice} />)}
        </Section>
      )}
    </>
  );
}
