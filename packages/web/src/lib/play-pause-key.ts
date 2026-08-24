import { useEffect } from "react";

// Space is the play/pause key everywhere audio plays, so the reader should not make anyone go
// looking for the button. It stays out of the way while text is being entered or a menu is open;
// buttons give up their space activation for it, which Enter still provides.
export function usePlayPauseKey(toggle: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    function handleKey(event: KeyboardEvent) {
      if (event.code !== "Space" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return;
      event.preventDefault();
      toggle();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [toggle, enabled]);
}
