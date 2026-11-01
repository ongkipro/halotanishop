import assert from "node:assert/strict";
import test from "node:test";
import { autoLoadMore } from "./auto-load-more.ts";

type Callback = (entries: { isIntersecting: boolean }[]) => void;

function harness(opts: { visible?: boolean } = {}) {
  let callback: Callback = () => {};
  let observed = 0;
  class FakeObserver {
    constructor(cb: Callback) {
      callback = cb;
    }
    observe() {
      observed++;
    }
    unobserve() {}
    disconnect() {}
  }
  const listeners = new Map<string, () => void>();
  const win = {
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  let clicks = 0;
  const button = {
    offsetParent: opts.visible === false ? null : {},
    click: () => {
      clicks++;
    },
  };
  return {
    button: button as unknown as HTMLElement,
    win,
    Observer: FakeObserver as unknown as typeof IntersectionObserver,
    fire: (isIntersecting: boolean) => callback([{ isIntersecting }]),
    fireBatch: (...flags: boolean[]) => callback(flags.map((isIntersecting) => ({ isIntersecting }))),
    touch: () => listeners.get("scroll")?.(),
    clicks: () => clicks,
    observed: () => observed,
    listenerCount: () => listeners.size,
  };
}

test("nothing loads until the visitor has scrolled or touched the page", () => {
  const h = harness();
  autoLoadMore(h.button, h.win, h.Observer);
  h.fire(true);
  assert.equal(h.clicks(), 0, "a button visible at load must not drain the list");
  h.touch();
  h.fire(true);
  assert.equal(h.clicks(), 1);
});

test("a button that left the screen, or is hidden because the list is done, is not clicked", () => {
  const h = harness();
  autoLoadMore(h.button, h.win, h.Observer);
  h.touch();
  h.fire(false);
  assert.equal(h.clicks(), 0);

  const done = harness({ visible: false });
  autoLoadMore(done.button, done.win, done.Observer);
  done.touch();
  done.fire(true);
  assert.equal(done.clicks(), 0);
});

test("each click re-observes the button, and the cleanup removes every listener", () => {
  const h = harness();
  const stop = autoLoadMore(h.button, h.win, h.Observer);
  h.touch();
  const before = h.observed();
  h.fire(true);
  assert.ok(h.observed() > before, "the button must be observed again after a click");
  stop?.();
  assert.equal(h.listenerCount(), 0);
});

test("without a button or IntersectionObserver it does nothing and the button keeps working", () => {
  const h = harness();
  assert.equal(autoLoadMore(null, h.win, h.Observer), undefined);
  assert.equal(autoLoadMore(h.button, h.win, undefined), undefined);
});

test("a quick flick that queues [visible, hidden] does not load for a button already past", () => {
  const h = harness();
  autoLoadMore(h.button, h.win, h.Observer);
  h.touch();
  h.fireBatch(true, false);
  assert.equal(h.clicks(), 0, "the newest report says the button is gone");
  h.fireBatch(false, true);
  assert.equal(h.clicks(), 1);
});

test("one page per gesture: a second sighting without a new scroll or touch does not click again", () => {
  const h = harness();
  autoLoadMore(h.button, h.win, h.Observer);
  h.touch();
  h.fire(true);
  h.fire(true);
  assert.equal(h.clicks(), 1, "a tall screen must not chain pages until the catalogue is drained");
  h.touch();
  h.fire(true);
  assert.equal(h.clicks(), 2);
});

test("Data Saver turns the automatic path off and leaves the button as the only one", () => {
  const h = harness();
  const stop = autoLoadMore(h.button, h.win, h.Observer, true);
  assert.equal(stop, undefined);
  assert.equal(h.listenerCount(), 0);
});
