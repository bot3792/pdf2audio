import { useEffect } from "react";

// Overscroll in a modal (incl. the PDF iframe viewer) chains to the page behind it —
// locking body scroll while the modal is open is the only fix that covers iframes.
export function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}
