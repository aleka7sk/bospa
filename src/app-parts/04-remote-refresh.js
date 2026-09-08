(() => {
  if (globalThis.__BOSPA_REMOTE_REFRESH__) return;
  globalThis.__BOSPA_REMOTE_REFRESH__ = true;
  const INTERVAL_MS = 20_000;
  let last = 0;

  function refresh() {
    const runtime = globalThis.bospaRemote;
    if (!runtime || runtime.mode !== 'remote' || document.hidden || !navigator.onLine) return;
    if (Date.now() - last < 5_000) return;
    last = Date.now();
    document.querySelector('[data-bospa-remote-indicator]')?.click();
  }

  const timer = setInterval(refresh, INTERVAL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('focus', refresh);
  window.addEventListener('pagehide', () => clearInterval(timer), {once:true});
})();
