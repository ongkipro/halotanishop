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
  saveData: boolean = typeof navigator !== "undefined" &&
    Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData),
): (() => void) | undefined {
  // Data Saver on: the visitor asked for fewer bytes, so the button is the only path.
  if (!button || !Observer || saveData) return undefined;

  let armed = false;
  const observer = new Observer(
    (entries) => {
      // The newest report decides: a quick flick can queue [visible, hidden], and
      // loading for a button that is already past is not what the visitor did.
      if (!armed || !entries[entries.length - 1]?.isIntersecting) return;
      // Hidden (display none or the `hidden` class) means nothing is left.
      if (button.offsetParent === null) return;
      button.click();
      // One page per gesture: a tall or wide screen would otherwise chain page
      // after page until the catalogue is drained. The next scroll or touch re-arms.
      armed = false;
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
