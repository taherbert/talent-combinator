/**
 * Registers a one-time mousedown handler that fires `onDismiss` when the user
 * clicks outside `el`. The handler removes itself after triggering.
 */
export function addDismissHandler(
  el: HTMLElement,
  onDismiss: () => void,
): void {
  const handler = (e: MouseEvent): void => {
    if (!el.contains(e.target as Node)) {
      onDismiss();
      document.removeEventListener("mousedown", handler);
    }
  };
  // Defer so the current click event doesn't immediately dismiss
  setTimeout(() => document.addEventListener("mousedown", handler), 0);
}
