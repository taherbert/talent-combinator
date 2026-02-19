/**
 * Clamp a fixed-position element so it stays entirely within the viewport.
 * Shrinks the element via max-width/max-height if it exceeds the available space.
 */
export function clampToViewport(el: HTMLElement, margin = 8): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const availW = vw - margin * 2;
  const availH = vh - margin * 2;

  // Shrink if element exceeds viewport
  let rect = el.getBoundingClientRect();
  if (rect.width > availW) el.style.maxWidth = `${availW}px`;
  if (rect.height > availH) el.style.maxHeight = `${availH}px`;

  // Re-measure after potential resize
  rect = el.getBoundingClientRect();
  let left = rect.left;
  let top = rect.top;

  if (rect.right > vw - margin) left = vw - margin - rect.width;
  if (rect.bottom > vh - margin) top = vh - margin - rect.height;
  if (left < margin) left = margin;
  if (top < margin) top = margin;

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}
