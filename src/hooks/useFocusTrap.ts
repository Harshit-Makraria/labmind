"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps Tab/Shift+Tab focus within the returned ref's subtree while `active`
 * is true, moves focus into it on mount, and restores focus to whatever was
 * focused before on unmount — without this, a keyboard user can Tab straight
 * through a modal's backdrop into the page behind it, and a screen reader
 * gets no signal that a dialog opened at all. Pass `onEscape` to let Escape
 * dismiss the modal (omit it for a modal that must be explicitly acted on,
 * e.g. a safety interrupt, where a silent Escape-dismiss would defeat the
 * point of forcing acknowledgment).
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean, onEscape?: () => void) {
  const containerRef = useRef<T>(null);
  // A ref, not a dependency — so a parent re-render passing a fresh inline
  // closure doesn't re-run the whole effect (which would re-steal focus
  // into the modal on every keystroke elsewhere in the app).
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null,
      );

    const first = focusable()[0];
    (first ?? container).focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && onEscapeRef.current) {
        e.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [active]);

  return containerRef;
}
