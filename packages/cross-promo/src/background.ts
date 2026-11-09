// Call once from each extension's service worker. Lets the maker's other extensions ask "are you
// installed?", so nobody is shown an extension they already have. It answers with nothing else.
export function listenForPromoPings(): void {
  chrome.runtime.onMessageExternal.addListener((msg, _sender, reply) => {
    if (msg?.type === "cross-promo:ping") reply({ ok: true });
    return false;
  });
}
