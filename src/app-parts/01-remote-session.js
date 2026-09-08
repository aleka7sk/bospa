(() => {
  if (globalThis.__BOSPA_REMOTE_SESSION_HELPER__) return;
  globalThis.__BOSPA_REMOTE_SESSION_HELPER__ = true;

  async function restoreCSRFToken() {
    const runtime = globalThis.bospaRemote;
    if (!runtime || runtime.csrfToken || runtime.mode === 'demo') return;
    const endpoints = ['/api/v1/auth/session', '/api/v1/auth/me', '/api/v1/bootstrap'];
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {credentials:'include', headers:{Accept:'application/json'}});
        if (!response.ok) continue;
        const payload = await response.json().catch(() => ({}));
        const token = payload.csrfToken || payload.data?.csrfToken || response.headers.get('X-CSRF-Token');
        if (token) {
          runtime.csrfToken = token;
          return;
        }
      } catch {}
    }
  }

  function mountLogoutAction() {
    const runtime = globalThis.bospaRemote;
    const popover = document.querySelector('.user-popover');
    if (!popover || !runtime || runtime.mode !== 'remote' || popover.querySelector('[data-bospa-logout]')) return;
    popover.insertAdjacentHTML('beforeend', `<button class="role-option bospa-logout-action" data-bospa-logout><span class="menu-icon">${icon('logout',18)}</span><span><strong>Выйти</strong><small>Завершить защищённую сессию</small></span></button>`);
  }

  const observer = new MutationObserver(() => mountLogoutAction());
  observer.observe(document.documentElement, {subtree:true, childList:true});
  window.addEventListener('focus', () => void restoreCSRFToken());
  window.addEventListener('online', () => void restoreCSRFToken());
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { void restoreCSRFToken(); mountLogoutAction(); }, {once:true});
  } else {
    void restoreCSRFToken();
    mountLogoutAction();
  }
})();
