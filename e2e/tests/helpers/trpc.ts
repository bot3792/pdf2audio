import type { APIRequestContext, APIResponse } from "@playwright/test";

type TrpcOpts = { profileId?: string };

function headers(opts?: TrpcOpts): Record<string, string> {
  return opts?.profileId ? { "x-profile-id": opts.profileId } : {};
}

async function unwrap(res: APIResponse, proc: string) {
  if (!res.ok()) throw new Error(`trpc ${proc} failed with ${res.status()}: ${await res.text()}`);
  const body = await res.json();
  return body.result?.data;
}

export async function trpcQuery(request: APIRequestContext, proc: string, input?: unknown, opts?: TrpcOpts) {
  const qs = input !== undefined ? `?input=${encodeURIComponent(JSON.stringify(input))}` : "";
  return unwrap(await request.get(`/trpc/${proc}${qs}`, { headers: headers(opts) }), proc);
}

export async function trpcMutation(request: APIRequestContext, proc: string, input?: unknown, opts?: TrpcOpts) {
  return unwrap(await request.post(`/trpc/${proc}`, { data: input ?? {}, headers: headers(opts) }), proc);
}

// profiles.delete refuses a non-empty profile, so drain folders (which cascade
// their books) and root books first
export async function purgeProfile(request: APIRequestContext, profileId: string) {
  const list = await trpcQuery(request, "books.list", undefined, { profileId });
  await Promise.all(
    (list?.folders ?? []).map((f: { id: string }) => trpcMutation(request, "folders.delete", { id: f.id }, { profileId })),
  );
  const ids = (list?.books ?? []).map((b: { id: string }) => b.id);
  if (ids.length > 0) await trpcMutation(request, "books.deleteMany", { ids }, { profileId });
  await trpcMutation(request, "profiles.delete", { id: profileId });
}
