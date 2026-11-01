/**
 * Load the next page of a list when its "load more" button scrolls into view.
 *
 * The button stays: it is the keyboard, no-JS and reduced-data path, and the
 * handler it already has (the catalogue filter, the /produk reveal) does the
 * work, so this only clicks it. Two guards keep it from behaving like a bug:
 * nothing loads until the visitor has scrolled or touched the page (a short
 * list or a tall screen would otherwise drain the whole catalogue at load), and
 * every click re-observes the button, because it only fires on a change of
 * visibility and the new cards may leave it on screen.
 */
export type AutoLoadWindow = {
  addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: () => void): void;
};

export function autoLoadMore(
  button: HTMLElement | null,
  win: AutoLoadWindow = window,
  Observer: typeof IntersectionObserver | undefined = typeof IntersectionObserver === "undefined"
    ? undefined
    : IntersectionObserver,
): (() => void) | undefined {
  if (!button || !Observer) return undefined;

  let armed = false;
  const observer = new Observer(
    (entries) => {
      if (!armed || !entries.some((entry) => entry.isIntersecting)) return;
      // Hidden (display none or the `hidden` class) means nothing is left.
      if (button.offsetParent === null) return;
      button.click();
      observer.unobserve(button);
      observer.observe(button);
    },
    // Start fetching a screen early so the next cards are there on arrival.
    { rootMargin: "0px 0px 400px 0px" },
  );

  const events = ["scroll", "pointerdown", "touchstart", "keydown"] as const;
  const arm = () => {
    if (armed) return;
    armed = true;
    for (const type of events) win.removeEventListener(type, arm);
    // Re-observe so a button already on screen is reported once more, armed.
    observer.unobserve(button);
    observer.observe(button);
  };
  for (const type of events) win.addEventListener(type, arm, { passive: true });
  observer.observe(button);

  return () => {
    observer.disconnect();
    for (const type of events) win.removeEventListener(type, arm);
  };
}
