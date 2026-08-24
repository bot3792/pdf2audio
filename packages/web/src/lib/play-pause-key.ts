import { useEffect } from "react";

// Space is the play/pause key everywhere audio plays, so the reader should not make anyone go
// looking for the button. It stays out of the way while text is being entered or a menu is open;
// buttons give up their space activation for it, which Enter still provides. When there is nothing
// to play the key is left alone, so it still pages down a long document.
export function usePlayPauseKey(toggle: () => boolean, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    function handleKey(event: KeyboardEvent) {
      if (event.code !== "Space" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return;
      if (toggle()) event.preventDefault();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [toggle, enabled]);
}
