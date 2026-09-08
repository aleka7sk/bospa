(() => {
  if (globalThis.__BOSPA_REMOTE_ID_RECONCILE__) return;
  globalThis.__BOSPA_REMOTE_ID_RECONCILE__ = true;

  function reconcileSelectedApplication() {
    const runtime = globalThis.bospaRemote;
    if (!runtime?.idMap || typeof ui === 'undefined') return;
    const selected = ui.selectedApplicationId;
    const mapped = selected && runtime.idMap[selected];
    if (!mapped || mapped === selected) return;
    ui.selectedApplicationId = mapped;
    if (ui.overlay?.applicationId === selected) ui.overlay.applicationId = mapped;
    if (typeof renderPortal === 'function') renderPortal();
  }

  const timer = setInterval(reconcileSelectedApplication, 350);
  window.addEventListener('pagehide', () => clearInterval(timer), {once:true});
  window.addEventListener('online', reconcileSelectedApplication);
})();
