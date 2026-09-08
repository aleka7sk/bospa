import {store, calculateStayTotal} from './store.js';
import {apartmentArtwork, initials, toDateKey} from './utils.js';

const DEFAULT_TIMEOUT_MS = 20_000;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class BospaApiError extends Error {
  constructor(message, {code = 'api_error', status = 0, requestId = '', cause = null} = {}) {
    super(message, cause ? {cause} : undefined);
    this.name = 'BospaApiError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

export function readCookie(name) {
  if (typeof document === 'undefined') return '';
  const prefix = `${encodeURIComponent(name)}=`;
  return document.cookie
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(prefix))
    ?.slice(prefix.length) || '';
}

function formatParts(value, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return parts;
}

export function apiDateKey(value, timeZone = 'Asia/Almaty') {
  const parts = formatParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function apiTime(value, timeZone = 'Asia/Almaty') {
  const parts = formatParts(value, timeZone);
  return `${parts.hour}:${parts.minute}`;
}

export function zonedDateTimeToISO(dateKey, timeValue = '00:00', timeZone = 'Asia/Almaty') {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  const [hour, minute, second = 0] = String(timeValue || '00:00').split(':').map(Number);
  const desiredAsUTC = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = desiredAsUTC;

  // Intl exposes the local representation for a UTC instant. Two passes are enough
  // to converge even around a daylight-saving boundary in future supported regions.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = formatParts(new Date(guess), timeZone);
    const representedAsUTC = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    guess += desiredAsUTC - representedAsUTC;
  }
  return new Date(guess).toISOString();
}

function moneyFromTiyn(value) { return Number(value || 0) / 100; }
function moneyToTiyn(value) { return Math.round(Number(value || 0) * 100); }
function timeOnly(value, fallback) { return String(value || fallback).slice(0, 5); }

export function mapApiUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    workspaceId: user.workspaceId,
    email: user.email || '',
    name: user.name || user.shortName || 'Пользователь',
    shortName: user.shortName || String(user.name || 'Пользователь').split(/\s+/)[0],
    role: user.role,
    active: user.active !== false,
    initials: initials(user.name || user.shortName),
    createdAt: user.createdAt,
  };
}

export function mapApiApartment(apartment, prior = null) {
  const mapped = {
    id: apartment.id,
    workspaceId: apartment.workspaceId,
    code: apartment.code,
    complex: apartment.complex || apartment.address,
    unit: apartment.unit,
    district: apartment.district || '',
    address: apartment.address,
    city: apartment.city || 'Астана',
    rooms: Number(apartment.rooms || 0),
    capacity: Number(apartment.capacity || 1),
    weekdayRate: moneyFromTiyn(apartment.weekdayRateTiyn),
    weekendRate: moneyFromTiyn(apartment.weekendRateTiyn),
    checkIn: timeOnly(apartment.checkInTime, '14:00'),
    checkOut: timeOnly(apartment.checkOutTime, '12:00'),
    active: apartment.active !== false,
    catalogEnabled: Boolean(apartment.catalogEnabled),
    published: Boolean(apartment.published),
    lockVersion: Number(apartment.lockVersion || 1),
    createdAt: apartment.createdAt,
    updatedAt: apartment.updatedAt,
    features: prior?.features || ['Wi‑Fi', 'Кухня', 'Smart TV'],
    description: prior?.description || 'Квартира из рабочего каталога bospa.',
  };
  mapped.photos = prior?.photos?.length
    ? prior.photos
    : Array.from({length: 4}, (_, index) => apartmentArtwork(mapped, index));
  return mapped;
}

export function mapApiApplication(application, timeZone = 'Asia/Almaty', prior = null) {
  const source = application.isTest && !String(application.source || '').includes('· Тест')
    ? `${application.source || 'Booking'} · Тест`
    : (application.source || 'Ручная');
  return {
    id: application.id,
    workspaceId: application.workspaceId,
    externalId: application.externalId,
    apartmentId: application.apartmentId,
    guestName: application.guestName || '',
    phone: application.phone || '',
    source,
    status: application.status,
    checkIn: apiDateKey(application.checkInAt, timeZone),
    checkOut: apiDateKey(application.checkOutAt, timeZone),
    checkInTime: apiTime(application.checkInAt, timeZone),
    checkOutTime: apiTime(application.checkOutAt, timeZone),
    total: moneyFromTiyn(application.totalAmountTiyn),
    requiredPrepayment: moneyFromTiyn(application.requiredPrepaymentTiyn),
    paid: moneyFromTiyn(application.paidAmountTiyn),
    deposit: moneyFromTiyn(application.depositAmountTiyn),
    claimUserId: application.claimedBy || null,
    creditedManagerId: application.creditedManagerId || null,
    isTest: Boolean(application.isTest),
    needsAlternative: Boolean(application.needsAlternative),
    pinnedNote: application.pinnedNote || '',
    lockVersion: Number(application.lockVersion || 1),
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    callbackAt: prior?.callbackAt || null,
    comments: prior?.comments || [],
    timeline: prior?.timeline || [],
  };
}

export function mapApiPayment(payment) {
  return {
    id: payment.id,
    applicationId: payment.applicationId,
    amount: moneyFromTiyn(payment.amountTiyn),
    kind: payment.kind,
    method: payment.method,
    status: payment.status,
    note: payment.note || '',
    receivedAt: payment.receivedAt,
    createdAt: payment.createdAt,
    createdBy: payment.createdBy,
  };
}

export function mapApiComment(comment) {
  return {
    id: comment.id,
    applicationId: comment.applicationId,
    authorId: comment.authorId,
    authorName: comment.authorName,
    text: comment.text,
    at: comment.createdAt,
  };
}

export function mapApiEvent(event) {
  return {
    id: String(event.id),
    type: event.type,
    text: event.text,
    actorId: event.actorId || null,
    actor: event.actorName || 'Система',
    metadata: event.metadata || {},
    at: event.createdAt,
  };
}

export class BospaApiClient {
  constructor({baseURL = '', timeout = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch} = {}) {
    this.baseURL = String(baseURL || '').replace(/\/$/, '');
    this.timeout = timeout;
    this.fetchImpl = fetchImpl;
  }

  async request(path, {method = 'GET', body, headers = {}, timeout = this.timeout} = {}) {
    if (typeof this.fetchImpl !== 'function') {
      throw new BospaApiError('Fetch API недоступен.', {code: 'api_unavailable'});
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const upperMethod = method.toUpperCase();
    const requestHeaders = {'Accept': 'application/json', ...headers};
    if (body !== undefined) requestHeaders['Content-Type'] ||= 'application/json';
    if (MUTATING_METHODS.has(upperMethod)) {
      const csrf = readCookie('bospa_csrf');
      if (csrf) requestHeaders['X-CSRF-Token'] = decodeURIComponent(csrf);
    }

    let response;
    try {
      response = await this.fetchImpl(`${this.baseURL}${path}`, {
        method: upperMethod,
        credentials: 'include',
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'Сервер не ответил вовремя.' : 'Не удалось связаться с Bospa API.';
      throw new BospaApiError(message, {code: error?.name === 'AbortError' ? 'timeout' : 'api_unavailable', cause: error});
    } finally {
      clearTimeout(timer);
    }

    const contentType = response.headers?.get?.('content-type') || '';
    let payload = null;
    if (response.status !== 204 && contentType.includes('application/json')) {
      try { payload = await response.json(); } catch { payload = null; }
    }
    if (!contentType.includes('application/json') && response.status !== 204) {
      throw new BospaApiError('Вместо API получен HTML или неизвестный ответ.', {code: 'api_unavailable', status: response.status});
    }
    if (!response.ok) {
      const error = payload?.error || {};
      throw new BospaApiError(error.message || `Ошибка HTTP ${response.status}`, {
        code: error.code || 'api_error',
        status: response.status,
        requestId: error.requestId || response.headers?.get?.('x-request-id') || '',
      });
    }
    return payload;
  }

  session() { return this.request('/api/v1/auth/session'); }
  login(email, password) { return this.request('/api/v1/auth/login', {method: 'POST', body: {email, password}}); }
  logout() { return this.request('/api/v1/auth/logout', {method: 'POST'}); }
  bootstrap({from = '', to = ''} = {}) {
    const query = new URLSearchParams();
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    return this.request(`/api/v1/bootstrap${query.size ? `?${query}` : ''}`);
  }
  application(id) { return this.request(`/api/v1/applications/${encodeURIComponent(id)}`); }
  createApplication(body) { return this.request('/api/v1/applications', {method: 'POST', body}); }
  updateApplication(id, body) { return this.request(`/api/v1/applications/${encodeURIComponent(id)}`, {method: 'PATCH', body}); }
  claimApplication(id) { return this.request(`/api/v1/applications/${encodeURIComponent(id)}/claim`, {method: 'POST'}); }
  updateStatus(id, status, lockVersion) { return this.request(`/api/v1/applications/${encodeURIComponent(id)}/status`, {method: 'PATCH', body: {status, lockVersion}}); }
  addComment(id, text) { return this.request(`/api/v1/applications/${encodeURIComponent(id)}/comments`, {method: 'POST', body: {text}}); }
  addContact(id, body) { return this.request(`/api/v1/applications/${encodeURIComponent(id)}/contacts`, {method: 'POST', body}); }
  addPayment(id, body) { return this.request(`/api/v1/applications/${encodeURIComponent(id)}/payments`, {method: 'POST', body}); }
  addRefund(id, body) { return this.request(`/api/v1/applications/${encodeURIComponent(id)}/refunds`, {method: 'POST', body}); }
  createApartment(body) { return this.request('/api/v1/apartments', {method: 'POST', body}); }
}

function mergeServerBootstrap(payload) {
  const current = store.getState();
  const timezone = payload.workspace?.timezone || current.workspace?.timezone || 'Asia/Almaty';
  const previousApartments = new Map((current.apartments || []).map(item => [item.id, item]));
  const previousApplications = new Map((current.applications || []).map(item => [item.id, item]));
  const mappedUser = mapApiUser(payload.user);
  const users = (payload.users?.length ? payload.users : [payload.user]).map(mapApiUser).filter(Boolean);
  if (mappedUser && !users.some(user => user.id === mappedUser.id)) users.unshift(mappedUser);

  return {
    ...current,
    session: {
      ...current.session,
      userId: mappedUser.id,
      role: mappedUser.role,
      serverMode: true,
    },
    workspace: {
      ...current.workspace,
      id: payload.workspace.id,
      name: payload.workspace.name,
      city: payload.workspace.city,
      timezone,
      status: payload.workspace.status,
      subscriptionStatus: payload.workspace.status,
    },
    users,
    apartments: (payload.apartments || []).map(item => mapApiApartment(item, previousApartments.get(item.id))),
    applications: (payload.applications || []).map(item => mapApiApplication(item, timezone, previousApplications.get(item.id))),
    payments: (current.payments || []).filter(payment => (payload.applications || []).some(application => application.id === payment.applicationId)),
    runtime: {
      ...(current.runtime || {}),
      mode: 'server',
      online: true,
      serverTime: payload.serverTime,
      syncedAt: new Date().toISOString(),
    },
  };
}

function replaceMappedApplication(rawApplication) {
  const current = store.getState();
  const timezone = current.workspace?.timezone || 'Asia/Almaty';
  const prior = current.applications.find(item => item.id === rawApplication.id);
  const mapped = mapApiApplication(rawApplication, timezone, prior);
  const next = structuredClone(current);
  const index = next.applications.findIndex(item => item.id === mapped.id);
  if (index >= 0) next.applications[index] = mapped;
  else next.applications.unshift(mapped);
  next.runtime = {...(next.runtime || {}), online: true, syncedAt: new Date().toISOString()};
  store.replace(next);
  return mapped;
}

function mergeMappedDetail(detail) {
  const current = store.getState();
  const timezone = current.workspace?.timezone || 'Asia/Almaty';
  const prior = current.applications.find(item => item.id === detail.application.id);
  const mappedApplication = mapApiApplication(detail.application, timezone, prior);
  mappedApplication.comments = (detail.comments || []).map(mapApiComment);
  mappedApplication.timeline = (detail.events || []).map(mapApiEvent);

  const next = structuredClone(current);
  const index = next.applications.findIndex(item => item.id === mappedApplication.id);
  if (index >= 0) next.applications[index] = mappedApplication;
  else next.applications.unshift(mappedApplication);
  next.payments = next.payments.filter(item => item.applicationId !== mappedApplication.id);
  next.payments.push(...(detail.payments || []).map(mapApiPayment));
  next.runtime = {...(next.runtime || {}), online: true, syncedAt: new Date().toISOString()};
  store.replace(next);
  return mappedApplication;
}

function apiApplicationInput(input, options = {}) {
  const current = store.getState();
  const timezone = current.workspace?.timezone || 'Asia/Almaty';
  const total = input.total === '' || input.total === undefined || input.total === null
    ? calculateStayTotal(current, input.apartmentId, input.checkIn, input.checkOut)
    : Number(input.total || 0);
  return {
    apartmentId: input.apartmentId,
    guestName: input.guestName?.trim() || '',
    phone: input.phone?.trim() || '',
    source: input.source || 'Ручная',
    status: options.technical ? 'technical' : (input.status || 'new'),
    checkInAt: zonedDateTimeToISO(input.checkIn, input.checkInTime || '14:00', timezone),
    checkOutAt: zonedDateTimeToISO(input.checkOut, input.checkOutTime || '12:00', timezone),
    totalAmountTiyn: moneyToTiyn(total),
    requiredPrepaymentTiyn: moneyToTiyn(input.requiredPrepayment),
    depositAmountTiyn: moneyToTiyn(input.deposit),
    pinnedNote: input.pinnedNote || '',
    isTest: Boolean(options.isTest),
    external: Boolean(options.external),
    externalId: options.externalId || input.externalId || '',
  };
}

function apiApartmentInput(input) {
  return {
    code: String(input.code || '').trim(),
    address: String(input.address || '').trim(),
    unit: String(input.unit || '').trim(),
    city: String(input.city || 'Астана').trim(),
    district: String(input.district || '').trim(),
    complex: String(input.complex || '').trim(),
    rooms: Number(input.rooms || 1),
    capacity: Number(input.capacity || 1),
    checkInTime: input.checkInTime || '14:00',
    checkOutTime: input.checkOutTime || '12:00',
    weekdayRateTiyn: moneyToTiyn(input.weekdayRate),
    weekendRateTiyn: moneyToTiyn(input.weekendRate),
    catalogEnabled: Boolean(input.catalogEnabled),
    published: Boolean(input.published),
  };
}

export function createBospaBackend({client = new BospaApiClient()} = {}) {
  const runtime = {
    status: 'booting',
    available: null,
    authenticated: false,
    error: null,
    client,
    pollTimer: null,
    inFlightRefresh: null,
  };

  function setStatus(status, patch = {}) {
    Object.assign(runtime, patch, {status});
  }

  async function withAuthHandling(operation) {
    try {
      const result = await operation();
      runtime.available = true;
      runtime.error = null;
      return result;
    } catch (error) {
      if (error instanceof BospaApiError && error.status === 401) {
        runtime.authenticated = false;
        setStatus('anonymous', {available: true, error: null});
      } else if (error instanceof BospaApiError && ['api_unavailable', 'timeout'].includes(error.code)) {
        runtime.available = false;
        runtime.error = error;
        if (runtime.authenticated) {
          const next = structuredClone(store.getState());
          next.runtime = {...(next.runtime || {}), online: false};
          store.replace(next);
        }
      }
      throw error;
    }
  }

  async function refreshBootstrap(options = {}) {
    if (runtime.inFlightRefresh) return runtime.inFlightRefresh;
    runtime.inFlightRefresh = withAuthHandling(async () => {
      const payload = await client.bootstrap(options);
      store.replace(mergeServerBootstrap(payload));
      runtime.authenticated = true;
      setStatus('authenticated', {available: true, error: null});
      return payload;
    }).finally(() => { runtime.inFlightRefresh = null; });
    return runtime.inFlightRefresh;
  }

  function startPolling() {
    clearInterval(runtime.pollTimer);
    runtime.pollTimer = setInterval(() => {
      if (runtime.status === 'authenticated' && typeof document !== 'undefined' && document.visibilityState === 'visible') {
        refreshBootstrap().catch(() => {});
      }
    }, 25_000);
  }

  return Object.assign(runtime, {
    isRemote() { return runtime.status === 'authenticated'; },
    isDemo() { return runtime.status === 'demo'; },
    async initialize() {
      setStatus('booting', {error: null});
      try {
        await client.session();
        await refreshBootstrap();
        startPolling();
      } catch (error) {
        if (error instanceof BospaApiError && error.status === 401) {
          setStatus('anonymous', {available: true, authenticated: false, error: null});
        } else {
          setStatus('anonymous', {available: false, authenticated: false, error});
        }
      }
      return runtime.status;
    },
    async login(email, password) {
      setStatus('booting', {error: null});
      try {
        await client.login(email, password);
        await refreshBootstrap();
        startPolling();
        return store.getState();
      } catch (error) {
        runtime.authenticated = false;
        setStatus('anonymous', {available: error?.code !== 'api_unavailable', error});
        throw error;
      }
    },
    async logout() {
      clearInterval(runtime.pollTimer);
      try { if (runtime.available !== false) await client.logout(); } catch {}
      runtime.authenticated = false;
      setStatus('anonymous', {error: null});
    },
    enterDemo() {
      clearInterval(runtime.pollTimer);
      store.reset();
      const next = structuredClone(store.getState());
      next.session.serverMode = false;
      next.runtime = {mode: 'demo', online: true, syncedAt: null};
      store.replace(next);
      setStatus('demo', {authenticated: false, error: null});
    },
    retry() { return this.initialize(); },
    refresh: refreshBootstrap,
    async loadApplicationDetail(id) {
      if (!this.isRemote()) return store.getState().applications.find(item => item.id === id);
      const detail = await withAuthHandling(() => client.application(id));
      return mergeMappedDetail(detail);
    },
    async createApplication(input, options = {}) {
      if (!this.isRemote()) return store.createApplication(input, options);
      const raw = await withAuthHandling(() => client.createApplication(apiApplicationInput(input, options)));
      return replaceMappedApplication(raw);
    },
    async claimApplication(id) {
      if (!this.isRemote()) return store.claimApplication(id);
      const raw = await withAuthHandling(() => client.claimApplication(id));
      return replaceMappedApplication(raw);
    },
    async setStatus(id, status) {
      if (!this.isRemote()) return store.setStatus(id, status);
      const application = store.getState().applications.find(item => item.id === id);
      const raw = await withAuthHandling(() => client.updateStatus(id, status, application?.lockVersion || 0));
      return replaceMappedApplication(raw);
    },
    async setPinnedNote(id, note) {
      if (!this.isRemote()) return store.setPinnedNote(id, note);
      const application = store.getState().applications.find(item => item.id === id);
      const raw = await withAuthHandling(() => client.updateApplication(id, {pinnedNote: note, lockVersion: application?.lockVersion || 0}));
      return replaceMappedApplication(raw);
    },
    async updateApplication(id, patch) {
      if (!this.isRemote()) return store.updateApplication(id, patch);
      const current = store.getState().applications.find(item => item.id === id);
      const timezone = store.getState().workspace?.timezone || 'Asia/Almaty';
      const body = {lockVersion: current?.lockVersion || 0};
      if ('guestName' in patch) body.guestName = patch.guestName;
      if ('phone' in patch) body.phone = patch.phone;
      if ('apartmentId' in patch) body.apartmentId = patch.apartmentId;
      if ('checkIn' in patch || 'checkInTime' in patch) body.checkInAt = zonedDateTimeToISO(patch.checkIn || current.checkIn, patch.checkInTime || current.checkInTime, timezone);
      if ('checkOut' in patch || 'checkOutTime' in patch) body.checkOutAt = zonedDateTimeToISO(patch.checkOut || current.checkOut, patch.checkOutTime || current.checkOutTime, timezone);
      if ('total' in patch) body.totalAmountTiyn = moneyToTiyn(patch.total);
      if ('requiredPrepayment' in patch) body.requiredPrepaymentTiyn = moneyToTiyn(patch.requiredPrepayment);
      if ('deposit' in patch) body.depositAmountTiyn = moneyToTiyn(patch.deposit);
      if ('pinnedNote' in patch) body.pinnedNote = patch.pinnedNote;
      const raw = await withAuthHandling(() => client.updateApplication(id, body));
      return replaceMappedApplication(raw);
    },
    async addPayment(id, input) {
      if (!this.isRemote()) return store.addPayment(id, input);
      const result = await withAuthHandling(() => client.addPayment(id, {
        amountTiyn: moneyToTiyn(input.amount),
        kind: input.kind || 'rent',
        method: input.method || 'Kaspi',
        note: input.note || '',
        receivedAt: input.receivedAt ? new Date(input.receivedAt).toISOString() : new Date().toISOString(),
      }));
      replaceMappedApplication(result.application);
      await this.loadApplicationDetail(id);
      return mapApiPayment(result.payment);
    },
    async addRefund(id, input) {
      if (!this.isRemote()) return store.addRefund(id, input.amount, input.reason);
      const result = await withAuthHandling(() => client.addRefund(id, {
        amountTiyn: moneyToTiyn(input.amount),
        method: input.method || 'Возврат',
        reason: input.reason || '',
        receivedAt: input.receivedAt ? new Date(input.receivedAt).toISOString() : new Date().toISOString(),
      }));
      replaceMappedApplication(result.application);
      await this.loadApplicationDetail(id);
      return mapApiPayment(result.refund);
    },
    async addComment(id, text) {
      if (!this.isRemote()) return store.addComment(id, text);
      await withAuthHandling(() => client.addComment(id, text));
      return this.loadApplicationDetail(id);
    },
    async addContactOutcome(id, outcome, note = '', callbackAt = null) {
      if (!this.isRemote()) return store.addContactOutcome(id, outcome, note, callbackAt);
      await withAuthHandling(() => client.addContact(id, {
        outcome,
        note,
        callbackAt: callbackAt ? new Date(callbackAt).toISOString() : null,
      }));
      return this.loadApplicationDetail(id);
    },
    async createApartment(input) {
      if (!this.isRemote()) {
        return store.createApartment(input);
      }
      const raw = await withAuthHandling(() => client.createApartment(apiApartmentInput(input)));
      const current = structuredClone(store.getState());
      current.apartments.push(mapApiApartment(raw));
      current.runtime = {...(current.runtime || {}), syncedAt: new Date().toISOString()};
      store.replace(current);
      return current.apartments.at(-1);
    },
    describeError(error) {
      if (!(error instanceof BospaApiError)) return error?.message || 'Не удалось выполнить действие.';
      const known = {
        unauthorized: 'Сессия завершена. Войдите снова.',
        invalid_credentials: 'Неверный email или пароль.',
        already_claimed: 'Заявку уже взял другой менеджер.',
        hard_conflict: 'Квартира уже занята гарантированной бронью.',
        conflict: 'Данные изменились на другом устройстве. Карточка обновлена.',
        csrf_failed: 'Сессия безопасности устарела. Обновите страницу.',
        api_unavailable: 'Bospa API сейчас недоступен.',
        timeout: 'Сервер отвечает слишком долго.',
      };
      return known[error.code] || error.message || 'Не удалось выполнить действие.';
    },
  });
}

export const backend = createBospaBackend();
