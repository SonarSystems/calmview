// Run something on the minute (or second) while an element is on screen: clocks, "now" lines,
// "5 minutes ago" labels. Hidden tabs don't tick (it catches up when shown), and it stops once the
// element is removed. The element may be drawn off-screen first: it waits up to 5 s to be attached.
export function live(el: Element, every: number, fn: () => void, now: () => Date = () => new Date()): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let started = false;
  const born = Date.now();
  const stop = () => (clearTimeout(timer), document.removeEventListener("visibilitychange", onVis));
  const run = () => {
    clearTimeout(timer);
    if (!el.isConnected) {
      if (started || Date.now() - born > 5000) return stop();
      return void (timer = setTimeout(run, 50));
    }
    started = true;
    if (document.hidden) return;
    fn();
    timer = setTimeout(run, every - (now().getTime() % every) + 15);
  };
  const onVis = () => !document.hidden && run();
  document.addEventListener("visibilitychange", onVis);
  run();
}
