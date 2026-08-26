import { trpc } from "../trpc.ts";

// Setup no longer downloads ~11 GB of models nobody asked for. Each optional bundle arrives at the
// one place its feature is requested, which is the same bargain PocketLanguageNotice already makes
// for voices — see that component for the shape this follows.
export function useModelBundle(id: string) {
  const { data: bundles } = trpc.models.list.useQuery(undefined, {
    // Only while something is downloading; otherwise this costs a Python start per poll
    refetchInterval: (q) => (q.state.data?.some((b) => b.downloading) ? 2000 : false),
    staleTime: 5_000,
  });
  const bundle = bundles?.find((b) => b.id === id) ?? null;
  return {
    bundle,
    // Unknown means the status call has not answered yet; blocking on that would flicker every
    // gated button on every page load, so treat it as ready until told otherwise.
    ready: bundle?.installed !== false,
  };
}

export function ModelBundleNotice({ id, verb }: { id: string; verb: string }) {
  const utils = trpc.useUtils();
  const { bundle } = useModelBundle(id);
  const download = trpc.models.download.useMutation({ onSuccess: () => void utils.models.list.invalidate() });

  if (!bundle || bundle.installed) return null;

  const gb = (bundle.approxMb / 1024).toFixed(1);
  return (
    <div className="rounded-md border border-(--border) bg-(--bg-subtle) px-3 py-2 text-xs space-y-1" data-testid={`model-notice-${id}`}>
      <p className="text-(--text-secondary)">
        {verb} needs the <strong>{bundle.label}</strong> models — about <strong>{gb} GB</strong>, once. {bundle.unlocks}.
      </p>
      {bundle.error && <p className="text-red-600" data-testid={`model-error-${id}`}>{bundle.error}</p>}
      <button
        type="button"
        onClick={() => download.mutate({ id })}
        disabled={bundle.downloading || download.isPending}
        className="px-2 py-1 rounded bg-blue-600 text-white disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        data-testid={`model-download-${id}`}
      >
        {bundle.downloading ? `Downloading ${bundle.label}…` : `Download (${gb} GB)`}
      </button>
      {bundle.downloading && (
        <p className="text-(--text-muted)">Keep using the app — this unlocks itself when it lands, no restart.</p>
      )}
    </div>
  );
}
