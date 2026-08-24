import { useState } from "react";
import { trpc } from "../trpc.ts";
import type { RouterInputs } from "../../../server/src/router.ts";
import { useBodyScrollLock } from "../lib/use-body-scroll-lock.ts";
import { formatTokens } from "../lib/ai-presets.ts";
import { TOOLBAR_BUTTON } from "../lib/button-classes.ts";

type CloudKeyVar = RouterInputs["llmModels"]["setKey"]["envVar"];

function Dot({ on }: { on: boolean }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${on ? "bg-green-500" : "bg-(--text-faint)"}`} />;
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  useBodyScrollLock();
  const utils = trpc.useUtils();
  // The status query always probes fresh server-side — the 30s cache still covers non-settings traffic
  const { data: status, isFetching, refetch } = trpc.llmModels.status.useQuery();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const refreshModels = () => {
    utils.llmModels.status.invalidate();
    utils.llmModels.list.invalidate();
  };
  const setKeyMutation = trpc.llmModels.setKey.useMutation({ onSuccess: refreshModels });
  const startServerMutation = trpc.llmModels.startLocalServer.useMutation({ onSuccess: refreshModels });

  const save = (envVar: CloudKeyVar) => {
    const value = drafts[envVar]?.trim();
    if (!value) return;
    setKeyMutation.mutate({ envVar, value });
    setDrafts((d) => ({ ...d, [envVar]: "" }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" data-testid="settings-modal">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-(--bg-card) rounded-xl shadow-2xl w-[640px] max-w-[94vw] max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-(--border)">
          <h2 className="text-lg font-semibold text-(--text-primary)">AI models</h2>
          <button onClick={onClose} className="text-(--text-muted) hover:text-(--text-primary) text-xl leading-none px-1" title="Close">
            ×
          </button>
        </div>

        <div className="p-4 space-y-6 overflow-y-auto">
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-(--text-primary)">Local models — offline, auto-detected</h3>
              <button
                onClick={() => refetch()}
                disabled={isFetching}
                className={TOOLBAR_BUTTON}
                data-testid="settings-rescan"
              >
                {isFetching ? "Scanning…" : "Rescan"}
              </button>
            </div>
            <div className="space-y-3">
              {(status?.local ?? []).map((server) => (
                <div key={server.name} className="rounded-md border border-(--border) p-3" data-testid={`settings-local-${server.name.replace(" ", "-").toLowerCase()}`}>
                  <div className="flex items-center gap-2 text-sm">
                    <Dot on={server.running} />
                    <span className="font-medium text-(--text-primary)">{server.name}</span>
                    <span className="text-(--text-faint) text-xs">{server.url}</span>
                    <span className={`ml-auto text-xs ${server.running ? "text-green-600" : "text-(--text-muted)"}`}>
                      {server.running ? `running — ${server.models.length} model${server.models.length === 1 ? "" : "s"}` : "not detected"}
                    </span>
                  </div>
                  {server.running && server.note && (
                    <p className="mt-1.5 text-xs text-(--text-muted) pl-4">{server.note}</p>
                  )}
                  {server.running ? (
                    server.models.length > 0 ? (
                      <ul className="mt-2 space-y-1">
                        {server.models.map((m) => (
                          <li key={m.key} className="flex items-center gap-2 text-xs text-(--text-secondary) pl-4">
                            <span className="font-mono">{m.label}</span>
                            <span className="text-(--text-faint)">{formatTokens(m.contextTokens)} context</span>
                            {m.supportsTools ? (
                              <span className="text-(--text-faint)">· chat tools</span>
                            ) : (
                              <span className="text-(--text-faint)">· no chat tools</span>
                            )}
                            {m.contextNote && <span className="text-amber-600">· {m.contextNote}</span>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-(--text-muted) pl-4">No chat models installed yet.</p>
                    )
                  ) : (
                    <div className="mt-2 flex items-center gap-2 pl-4">
                      <button
                        onClick={() => startServerMutation.mutate({ name: server.name })}
                        disabled={startServerMutation.isPending}
                        className="text-xs px-2.5 py-1 rounded-md bg-blue-600 text-white font-medium disabled:opacity-50"
                        data-testid={`settings-start-${server.name.replace(" ", "-").toLowerCase()}`}
                      >
                        {startServerMutation.isPending ? "Starting…" : "Start server"}
                      </button>
                      <p className="text-xs text-(--text-muted)">{server.startHint}</p>
                    </div>
                  )}
                </div>
              ))}
              {(status?.custom ?? []).map((entry) => (
                <div key={entry.key} className="rounded-md border border-(--border) p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Dot on={true} />
                    <span className="font-medium text-(--text-primary)">{entry.label}</span>
                    <span className="text-(--text-faint) text-xs">{entry.url}</span>
                    <span className="ml-auto text-xs text-(--text-muted)">custom (.env)</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-(--text-primary) mb-2">Cloud providers — need an API key</h3>
            <div className="space-y-3">
              {(status?.cloud ?? []).map((p) => (
                <div key={p.envVar} className="rounded-md border border-(--border) p-3" data-testid={`settings-cloud-${p.provider}`}>
                  <div className="flex items-center gap-2 text-sm">
                    <Dot on={p.configured} />
                    <span className="font-medium text-(--text-primary)">{p.label}</span>
                    <span className="text-xs text-(--text-faint)">{p.models.join(", ")}</span>
                    <span className={`ml-auto text-xs ${p.configured ? "text-green-600" : "text-(--text-muted)"}`}>
                      {p.configured ? `key set (${p.keyHint})` : "no key"}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="password"
                      value={drafts[p.envVar] ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [p.envVar]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && save(p.envVar)}
                      placeholder={p.configured ? "Paste a new key to replace it" : "Paste API key"}
                      className="flex-1 text-xs rounded-md border border-(--border-input) bg-(--bg-input) px-2 py-1.5 text-(--text-primary) focus:outline-none focus:border-blue-500"
                      data-testid={`settings-key-input-${p.provider}`}
                    />
                    <button
                      onClick={() => save(p.envVar)}
                      disabled={!drafts[p.envVar]?.trim() || setKeyMutation.isPending}
                      className="text-xs px-2.5 py-1.5 rounded-md bg-blue-600 text-white font-medium disabled:opacity-50"
                      data-testid={`settings-key-save-${p.provider}`}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setKeyMutation.mutate({ envVar: p.envVar, value: null })}
                      disabled={!p.configured || setKeyMutation.isPending}
                      title={p.configured ? "Remove the key from .env" : "No key to remove"}
                      className={TOOLBAR_BUTTON}
                      data-testid={`settings-key-remove-${p.provider}`}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {setKeyMutation.error && <p className="mt-2 text-xs text-red-600">{setKeyMutation.error.message}</p>}
            {startServerMutation.error && <p className="mt-2 text-xs text-red-600">{startServerMutation.error.message}</p>}
            <p className="mt-3 text-xs text-(--text-faint)">
              Keys are written to the .env file on this machine, take effect immediately, and are never sent back to the browser.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
