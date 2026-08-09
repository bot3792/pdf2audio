export type TranslationLiveEvent =
  | { type: "snapshot"; text: string }
  | { type: "delta"; text: string }
  | { type: "thinking"; text: string }
  | { type: "status"; status: "done" | "failed" | "suspended"; error?: string };

type Listener = (event: TranslationLiveEvent) => void;

const sessions = new Map<string, { text: string; thinking: string }>();
const listeners = new Map<string, Set<Listener>>();

function emit(translationId: string, event: TranslationLiveEvent) {
  for (const listener of listeners.get(translationId) ?? []) listener(event);
}

export function subscribeTranslationLive(translationId: string, listener: Listener): () => void {
  let set = listeners.get(translationId);
  if (!set) {
    set = new Set();
    listeners.set(translationId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(translationId);
  };
}

export function liveTranslationState(translationId: string): { text: string; thinking: string } | null {
  const session = sessions.get(translationId);
  return session ? { text: session.text, thinking: session.thinking } : null;
}

// Returns a handle bound to this run; a newer beginTranslationLive for the same
// translation turns the old handle into a no-op so a fenced-out run can't clobber it.
export function beginTranslationLive(translationId: string, initialText: string) {
  const session = { text: initialText, thinking: "" };
  sessions.set(translationId, session);
  emit(translationId, { type: "snapshot", text: initialText });
  const owned = () => sessions.get(translationId) === session;
  return {
    think(delta: string) {
      if (!owned() || !delta) return;
      session.thinking += delta;
      emit(translationId, { type: "thinking", text: delta });
    },
    append(delta: string) {
      if (!owned() || !delta) return;
      session.thinking = "";
      session.text += delta;
      emit(translationId, { type: "delta", text: delta });
    },
    sync(text: string) {
      if (!owned() || text === session.text) return;
      session.text = text;
      emit(translationId, { type: "snapshot", text });
    },
    end(status: "done" | "failed" | "suspended", error?: string) {
      if (!owned()) return;
      sessions.delete(translationId);
      emit(translationId, { type: "status", status, ...(error ? { error } : {}) });
    },
  };
}

export type TranslationLiveHandle = ReturnType<typeof beginTranslationLive>;
