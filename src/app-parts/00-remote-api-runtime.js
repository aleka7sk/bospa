(() => {
  if (globalThis.__BOSPA_REMOTE_RUNTIME__) return;
  globalThis.__BOSPA_REMOTE_RUNTIME__ = true;

  const API_BASE = '/api/v1';
  const QUEUE_KEY = 'bospa-remote-mutation-queue-v1';
  const ID_MAP_KEY = 'bospa-remote-id-map-v1';
  const mutationStorage = globalThis.sessionStorage || globalThis.localStorage;
  const runtime = {
    mode: 'detecting',
    csrfToken: '',
    queue: safeJsonParse(mutationStorage.getItem(QUEUE_KEY), []),
    idMap: safeJsonParse(localStorage.getItem(ID_MAP_KEY), {}),
    flushing: false,
    lastSyncAt: null,
    lastError: '',
  };
  globalThis.bospaRemote = runtime;

  class BospaAPIError extends Error {
    constructor(message, status = 0, payload = null) {
      super(message);
      this.name = 'BospaAPIError';
      this.status = status;
      this.payload = payload;
    }
  }

  async function apiRequest(path, options = {}) {
    const method = options.method || 'GET';
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    if (options.body !== undefined && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && runtime.csrfToken) headers.set('X-CSRF-Token', runtime.csrfToken);
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers,
      body: options.body === undefined ? undefined : options.body instanceof FormData ? options.body : JSON.stringify(options.body),
      signal: options.signal,
    });
    const type = response.headers.get('content-type') || '';
    const payload = type.includes('application/json') ? await response.json().catch(() => null) : await response.text().catch(() => '');
    if (!response.ok) {
      const message = payload?.message || payload?.error || `HTTP ${response.status}`;
      throw new BospaAPIError(message, response.status, payload);
    }
    if (payload?.csrfToken) runtime.csrfToken = payload.csrfToken;
    return payload;
  }

  const money = (object, primary, fallback) => {
    if (object?.[primary] !== undefined && object?.[primary] !== null) return Math.round(Number(object[primary]) / 100);
    return Number(object?.[fallback] || 0);
  };
  const dateKey = value => value ? toDateKey(new Date(value)) : todayKey();
  const timeKey = (value, fallback) => value ? new Date(value).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit', hour12:false}) : fallback;
  const remoteId = id => runtime.idMap[id] || id;

  function normalizeUser(user) {
    const name = user.name || user.fullName || user.email || 'Пользователь';
    return {
      id: user.id || user.userId,
      name,
      shortName: user.shortName || name.split(/\s+/)[0],
      role: String(user.role || 'manager').toLowerCase(),
      active: user.active !== false && user.status !== 'disabled',
      initials: user.initials || initials(name),
      email: user.email || '',
    };
  }

  function normalizeApartment(apartment) {
    const address = apartment.address || apartment.title || 'Квартира';
    const unit = apartment.unit || apartment.apartmentNumber || apartment.number || '';
    return {
      id: apartment.id,
      code: apartment.code || apartment.publicCode || String(apartment.id || '').slice(0, 8).toUpperCase(),
      complex: apartment.complex || apartment.residentialComplex || address.split(',')[0],
      unit,
      district: apartment.district || apartment.area || '',
      address,
      city: apartment.city || 'Астана',
      rooms: Number(apartment.rooms || 1),
      capacity: Number(apartment.capacity || apartment.guests || 2),
      weekdayRate: money(apartment, 'weekdayRateTiyn', 'weekdayRate'),
      weekendRate: money(apartment, 'weekendRateTiyn', 'weekendRate'),
      checkIn: apartment.defaultCheckIn || apartment.checkIn || '14:00',
      checkOut: apartment.defaultCheckOut || apartment.checkOut || '12:00',
      active: apartment.active !== false,
      catalogEnabled: Boolean(apartment.catalogEnabled),
      published: Boolean(apartment.published),
      features: apartment.features || [],
      description: apartment.description || '',
      photos: apartment.photos || [],
      lockVersion: Number(apartment.lockVersion || 0),
    };
  }

  function normalizeApplication(application) {
    const checkInAt = application.checkInAt || application.checkIn;
    const checkOutAt = application.checkOutAt || application.checkOut;
    const id = application.id;
    return {
      id,
      remoteId: id,
      externalId: application.externalId || application.providerExternalId || `BOSPA-${String(id).slice(0, 8)}`,
      apartmentId: application.apartmentId,
      guestName: application.guestName || application.name || '',
      phone: application.phone || application.guestPhone || '',
      source: application.source || 'Ручная',
      status: application.status || 'new',
      checkIn: dateKey(checkInAt),
      checkOut: dateKey(checkOutAt),
      checkInTime: application.checkInTime || timeKey(checkInAt, '14:00'),
      checkOutTime: application.checkOutTime || timeKey(checkOutAt, '12:00'),
      total: money(application, 'totalAmountTiyn', 'total'),
      requiredPrepayment: money(application, 'requiredPrepaymentTiyn', 'requiredPrepayment'),
      paid: money(application, 'paidAmountTiyn', 'paid'),
      deposit: money(application, 'depositAmountTiyn', 'deposit'),
      claimUserId: application.claimUserId || application.claimedByUserId || null,
      creditedManagerId: application.creditedManagerId || null,
      isTest: Boolean(application.isTest),
      needsAlternative: Boolean(application.needsAlternative),
      pinnedNote: application.pinnedNote || '',
      createdAt: application.createdAt || new Date().toISOString(),
      updatedAt: application.updatedAt || application.createdAt || new Date().toISOString(),
      comments: application.comments || [],
      timeline: application.timeline || application.events || [],
      lockVersion: Number(application.lockVersion || 0),
      syncState: 'synced',
    };
  }

  function normalizePayment(payment) {
    return {
      id: payment.id,
      applicationId: payment.applicationId,
      amount: money(payment, 'amountTiyn', 'amount'),
      kind: payment.kind || 'rent',
      method: payment.method || 'Другое',
      status: payment.status || 'confirmed',
      createdAt: payment.createdAt || new Date().toISOString(),
      createdBy: payment.createdBy || payment.createdByUserId,
      note: payment.note || '',
    };
  }

  function hydrateFromBootstrap(payload) {
    const data = payload?.data || payload || {};
    const current = store.getState();
    const principal = data.principal || data.currentUser || data.user || data.session?.user;
    const users = (data.users || data.members || (principal ? [principal] : [])).map(normalizeUser).filter(user => user.id);
    const next = structuredClone(current);
    if (data.workspace) next.workspace = {...next.workspace, ...data.workspace, id:data.workspace.id || next.workspace.id, name:data.workspace.name || next.workspace.name};
    if (users.length) next.users = users;
    if (Array.isArray(data.apartments)) next.apartments = data.apartments.map(normalizeApartment);
    if (Array.isArray(data.applications)) next.applications = data.applications.map(normalizeApplication);
    if (Array.isArray(data.payments)) next.payments = data.payments.map(normalizePayment);
    if (Array.isArray(data.notifications)) next.notifications = data.notifications;
    if (Array.isArray(data.priceOverrides)) next.priceOverrides = data.priceOverrides;
    if (principal) {
      const user = normalizeUser(principal);
      if (!next.users.some(item => item.id === user.id)) next.users.unshift(user);
      next.session.userId = user.id;
      next.session.role = user.role;
    }
    next.remote = {enabled:true, lastSyncAt:new Date().toISOString()};
    runtime.mode = 'remote';
    runtime.lastSyncAt = next.remote.lastSyncAt;
    runtime.lastError = '';
    store.replace(next);
    mountRemoteIndicator();
    return next;
  }

  async function refreshRemoteState({silent = false} = {}) {
    try {
      const payload = await apiRequest('/bootstrap');
      hydrateFromBootstrap(payload);
      hideAuthGate();
      if (!silent && typeof showToast === 'function') showToast('Данные синхронизированы');
      return true;
    } catch (error) {
      runtime.lastError = error.message;
      if (error.status === 401) {
        runtime.mode = 'auth-required';
        renderAuthGate();
        return false;
      }
      runtime.mode = navigator.onLine ? 'api-unavailable' : 'offline';
      mountRemoteIndicator();
      return false;
    }
  }

  function persistQueue() {
    mutationStorage.setItem(QUEUE_KEY, JSON.stringify(runtime.queue));
    localStorage.setItem(ID_MAP_KEY, JSON.stringify(runtime.idMap));
    mountRemoteIndicator();
  }

  function enqueue(type, localId, body = null) {
    runtime.queue.push({id:uid('mutation'), type, localId, body, createdAt:new Date().toISOString(), attempts:0});
    const application = store.getState().applications.find(item => item.id === localId);
    if (application) application.syncState = 'pending';
    persistQueue();
    void flushQueue();
  }

  function operationFor(item) {
    const id = remoteId(item.localId);
    if (item.type === 'application:create') return {path:'/applications', method:'POST', body:item.body};
    if (item.type === 'application:claim') return {path:`/applications/${id}/claim`, method:'POST', body:item.body || {}};
    if (item.type === 'application:status') return {path:`/applications/${id}/status`, method:'PATCH', body:item.body};
    if (item.type === 'payment:create') return {path:`/applications/${id}/payments`, method:'POST', body:item.body};
    if (item.type === 'comment:create') return {path:`/applications/${id}/comments`, method:'POST', body:item.body};
    if (item.type === 'refund:create') return {path:`/applications/${id}/refunds`, method:'POST', body:item.body};
    if (item.type === 'application:update') return {path:`/applications/${id}`, method:'PATCH', body:item.body};
    throw new Error(`UNKNOWN_REMOTE_OPERATION:${item.type}`);
  }

  async function flushQueue() {
    if (runtime.flushing || runtime.mode !== 'remote' || !navigator.onLine || !runtime.queue.length) return;
    runtime.flushing = true;
    try {
      while (runtime.queue.length && runtime.mode === 'remote' && navigator.onLine) {
        const item = runtime.queue[0];
        item.attempts += 1;
        persistQueue();
        try {
          const operation = operationFor(item);
          const result = await apiRequest(operation.path, operation);
          if (item.type === 'application:create') {
            const created = result?.application || result?.data || result;
            if (created?.id) runtime.idMap[item.localId] = created.id;
          }
          runtime.queue.shift();
          persistQueue();
        } catch (error) {
          runtime.lastError = error.message;
          if (error.status === 401) {
            runtime.mode = 'auth-required';
            renderAuthGate();
            break;
          }
          if ([400, 403, 404, 409, 422].includes(error.status)) {
            runtime.queue.shift();
            persistQueue();
            if (typeof showToast === 'function') showToast(`Сервер отклонил изменение: ${error.message}`, 'error', 5200);
            await refreshRemoteState({silent:true});
            continue;
          }
          break;
        }
      }
      if (!runtime.queue.length && runtime.mode === 'remote') await refreshRemoteState({silent:true});
    } finally {
      runtime.flushing = false;
      mountRemoteIndicator();
    }
  }

  function installStoreBridge() {
    if (store.__remoteBridgeInstalled) return;
    store.__remoteBridgeInstalled = true;
    const original = {};
    for (const name of ['createApplication','claimApplication','setStatus','addPayment','addComment','addRefund','setPinnedNote','updateApplication']) original[name] = store[name]?.bind(store);

    if (original.createApplication) store.createApplication = function(input, options = {}) {
      const application = original.createApplication(input, options);
      if (runtime.mode === 'remote' && !options.isTest && !options.technical) {
        enqueue('application:create', application.id, {
          apartmentId:input.apartmentId,
          guestName:input.guestName || '',
          phone:input.phone,
          source:input.source || 'Ручная',
          status:input.status || 'new',
          checkInAt:new Date(`${input.checkIn}T${input.checkInTime || '14:00'}:00`).toISOString(),
          checkOutAt:new Date(`${input.checkOut}T${input.checkOutTime || '12:00'}:00`).toISOString(),
          totalAmountTiyn:Math.round(Number(application.total || 0) * 100),
          requiredPrepaymentTiyn:Math.round(Number(application.requiredPrepayment || 0) * 100),
          depositAmountTiyn:Math.round(Number(application.deposit || 0) * 100),
          pinnedNote:input.pinnedNote || '',
        });
      }
      return application;
    };

    if (original.claimApplication) store.claimApplication = function(id) {
      const result = original.claimApplication(id);
      if (runtime.mode === 'remote') enqueue('application:claim', id, {lockVersion:Number(result.lockVersion || 0)});
      return result;
    };

    if (original.setStatus) store.setStatus = function(id, status) {
      const before = store.getState().applications.find(item => item.id === id);
      const result = original.setStatus(id, status);
      if (runtime.mode === 'remote' && !result.isTest) enqueue('application:status', id, {status, lockVersion:Number(before?.lockVersion || result.lockVersion || 0)});
      return result;
    };

    if (original.addPayment) store.addPayment = function(id, input) {
      const result = original.addPayment(id, input);
      if (runtime.mode === 'remote') enqueue('payment:create', id, {
        amountTiyn:Math.round(Number(input.amount || 0) * 100),
        kind:input.kind || 'rent', method:input.method || 'Другое', note:input.note || '',
      });
      return result;
    };

    if (original.addComment) store.addComment = function(id, text) {
      const result = original.addComment(id, text);
      if (runtime.mode === 'remote' && text?.trim()) enqueue('comment:create', id, {text:text.trim()});
      return result;
    };

    if (original.addRefund) store.addRefund = function(id, amount, reason = '') {
      const result = original.addRefund(id, amount, reason);
      if (runtime.mode === 'remote') enqueue('refund:create', id, {amountTiyn:Math.round(Math.abs(Number(amount)) * 100), reason});
      return result;
    };

    if (original.setPinnedNote) store.setPinnedNote = function(id, text) {
      const application = store.getState().applications.find(item => item.id === id);
      const result = original.setPinnedNote(id, text);
      if (runtime.mode === 'remote') enqueue('application:update', id, {pinnedNote:text.trim(), lockVersion:Number(application?.lockVersion || 0)});
      return result;
    };

    if (original.updateApplication) store.updateApplication = function(id, patch, timelineText) {
      const application = store.getState().applications.find(item => item.id === id);
      const result = original.updateApplication(id, patch, timelineText);
      if (runtime.mode === 'remote') {
        const body = {...patch, lockVersion:Number(application?.lockVersion || 0)};
        if (patch.total !== undefined) { body.totalAmountTiyn = Math.round(Number(patch.total) * 100); delete body.total; }
        if (patch.requiredPrepayment !== undefined) { body.requiredPrepaymentTiyn = Math.round(Number(patch.requiredPrepayment) * 100); delete body.requiredPrepayment; }
        if (patch.deposit !== undefined) { body.depositAmountTiyn = Math.round(Number(patch.deposit) * 100); delete body.deposit; }
        enqueue('application:update', id, body);
      }
      return result;
    };
  }

  function authMarkup(message = '') {
    const localhost = ['localhost','127.0.0.1'].includes(location.hostname);
    return `<div class="bospa-auth-gate" data-bospa-auth-gate>
      <div class="bospa-auth-ambient ambient-one"></div><div class="bospa-auth-ambient ambient-two"></div>
      <section class="bospa-auth-card" aria-labelledby="bospa-auth-title">
        <div class="bospa-auth-brand"><span class="brand-mark">${icon('calendar',24)}</span><span>bospa</span></div>
        <div class="bospa-auth-copy"><span class="eyebrow">Рабочее пространство команды</span><h1 id="bospa-auth-title">Войдите в календарь бронирований</h1><p>Заявки, оплаты, квартиры и работа менеджеров синхронизируются через защищённый Bospa API.</p></div>
        ${message ? `<div class="bospa-auth-error">${icon('alert',18)}<span>${escapeHtml(message)}</span></div>` : ''}
        <form data-bospa-auth-form="login" class="bospa-auth-form">
          <label><span>Email</span><input name="email" type="email" autocomplete="username" value="${localhost ? 'owner@bospa.local' : ''}" required /></label>
          <label><span>Пароль</span><input name="password" type="password" autocomplete="current-password" value="${localhost ? 'bospa-local-owner-2026!' : ''}" minlength="8" required /></label>
          <button class="button primary full" type="submit">Войти в bospa</button>
        </form>
        <div class="bospa-auth-meta"><span>${icon('lock',16)}HttpOnly session cookie</span><span>${icon('shield',16)}CSRF protection</span></div>
        <button class="bospa-demo-link" type="button" data-bospa-demo>Продолжить в автономном демо-режиме</button>
      </section>
    </div>`;
  }

  function renderAuthGate(message = '') {
    let gate = document.querySelector('[data-bospa-auth-gate]');
    if (!gate) {
      document.body.insertAdjacentHTML('beforeend', authMarkup(message));
      gate = document.querySelector('[data-bospa-auth-gate]');
    } else if (message) gate.outerHTML = authMarkup(message);
    document.body.classList.add('bospa-auth-open');
  }

  function hideAuthGate() {
    document.querySelector('[data-bospa-auth-gate]')?.remove();
    document.body.classList.remove('bospa-auth-open');
  }

  function mountRemoteIndicator() {
    const host = document.querySelector('.topbar-actions');
    if (!host) return;
    host.querySelector('[data-bospa-remote-indicator]')?.remove();
    const label = runtime.mode === 'remote' ? (runtime.queue.length ? `Синхронизация · ${runtime.queue.length}` : 'Онлайн') : runtime.mode === 'offline' ? 'Офлайн' : runtime.mode === 'api-unavailable' ? 'API недоступен' : 'Демо';
    const tone = runtime.mode === 'remote' && !runtime.queue.length ? 'online' : runtime.mode === 'offline' ? 'offline' : 'pending';
    host.insertAdjacentHTML('afterbegin', `<button class="bospa-remote-indicator ${tone}" data-bospa-remote-indicator title="${escapeHtml(runtime.lastError || 'Bospa API')}"><i></i><span>${label}</span></button>`);
  }

  async function login(form) {
    const submit = form.querySelector('button[type=submit]');
    submit.disabled = true;
    submit.textContent = 'Входим…';
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const payload = await apiRequest('/auth/login', {method:'POST', body:data});
      runtime.csrfToken = payload?.csrfToken || runtime.csrfToken;
      runtime.mode = 'remote';
      const ok = await refreshRemoteState({silent:true});
      if (ok) {
        hideAuthGate();
        if (typeof render === 'function') render();
        if (typeof showToast === 'function') showToast('Добро пожаловать в bospa');
        await flushQueue();
      }
    } catch (error) {
      renderAuthGate(error.status === 401 ? 'Неверный email или пароль' : `Не удалось войти: ${error.message}`);
    }
  }

  async function logout() {
    try { await apiRequest('/auth/logout', {method:'POST', body:{}}); } catch {}
    runtime.mode = 'auth-required';
    runtime.csrfToken = '';
    runtime.queue = [];
    mutationStorage.removeItem(QUEUE_KEY);
    renderAuthGate();
  }

  function installDOMHandlers() {
    document.addEventListener('submit', event => {
      const form = event.target.closest('[data-bospa-auth-form]');
      if (!form) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void login(form);
    }, true);
    document.addEventListener('click', event => {
      if (event.target.closest('[data-bospa-demo]')) {
        runtime.mode = 'demo';
        hideAuthGate();
        mountRemoteIndicator();
      }
      if (event.target.closest('[data-bospa-logout]')) void logout();
      if (event.target.closest('[data-bospa-remote-indicator]')) void refreshRemoteState();
    }, true);
    window.addEventListener('online', () => { runtime.mode = runtime.mode === 'offline' ? 'remote' : runtime.mode; void flushQueue(); void refreshRemoteState({silent:true}); });
    window.addEventListener('offline', () => { if (runtime.mode === 'remote') runtime.mode = 'offline'; mountRemoteIndicator(); });
    const observer = new MutationObserver(() => {
      if (!document.querySelector('[data-bospa-remote-indicator]')) mountRemoteIndicator();
    });
    observer.observe(document.documentElement, {subtree:true, childList:true});
  }

  installStoreBridge();
  installDOMHandlers();
  const start = () => void refreshRemoteState({silent:true}).then(() => flushQueue());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
