import { useMemo } from "react";

import { pocketCustomVoiceToEntry, pocketVoiceToEntry, POCKET_CUSTOM_PREFIX } from "../../lib/voices.ts";
import { trpc } from "../../trpc.ts";
import { PocketVoiceCloner } from "./PocketVoiceCloner.tsx";
import { VoiceRow } from "./VoiceRow.tsx";
import { Empty, Section } from "./layout.tsx";

export function PocketTab({ query, matches }: { query: string; matches: (label: string, note?: string) => boolean }) {
  const { data: pocket, isLoading, refetch } = trpc.pocketVoices.list.useQuery(undefined, { staleTime: Infinity });
  const deleteCustomVoice = trpc.pocketVoices.deleteCustom.useMutation({ onSuccess: () => void refetch() });

  const catalog = useMemo(() => (pocket?.voices ?? []).map(pocketVoiceToEntry), [pocket]);
  const custom = useMemo(() => (pocket?.custom ?? []).map(pocketCustomVoiceToEntry), [pocket]);

  if (isLoading) return <Empty>Loading voices…</Empty>;
  if (!pocket?.installed) {
    return <Empty>Pocket TTS is not installed — run <code>pnpm run setup</code> to create .venv-pocket.</Empty>;
  }

  const visibleCustom = custom.filter((voice) => matches(voice.label, voice.note));
  const visibleCatalog = catalog.filter((voice) => matches(voice.label, voice.note));

  return (
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

      <Section label={`Built-in · ${visibleCatalog.length}`}>
        {visibleCatalog.length === 0
          ? <Empty>No voices match “{query}”.</Empty>
          : visibleCatalog.map((voice) => <VoiceRow key={voice.id} voice={voice} />)}
      </Section>
    </>
  );
}
