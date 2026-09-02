import {seedState} from './data.js';
import {addDays, csvEscape, dayDiff, fromDateKey, isWeekend, overlaps, safeJsonParse, toDateKey, uid} from './utils.js';

const STORAGE_KEY = 'bospa-state-v3';

export const STATUS = {
  new: {label: 'Новая заявка', tone: 'soft', hard: false, active: true},
  no_answer: {label: 'Не дозвонились', tone: 'soft', hard: false, active: true},
  thinking: {label: 'Клиент думает', tone: 'soft', hard: false, active: true},
  awaiting_prepayment: {label: 'Ожидаем предоплату', tone: 'soft', hard: false, active: true},
  prepaid: {label: 'Предоплачено', tone: 'prepaid', hard: true, active: true},
  paid: {label: 'Оплачено', tone: 'paid', hard: true, active: true},
  completed: {label: 'Завершено', tone: 'completed', hard: false, active: false},
  declined: {label: 'Отказ клиента', tone: 'negative', hard: false, active: false},
  unpaid: {label: 'Не оплатил', tone: 'negative', hard: false, active: false},
  cancelled_client: {label: 'Отменено клиентом', tone: 'negative', hard: false, active: false},
  cancelled_company: {label: 'Отменено компанией', tone: 'negative', hard: false, active: false},
  duplicate: {label: 'Дубль', tone: 'system', hard: false, active: false},
  error: {label: 'Ошибка', tone: 'system', hard: false, active: false},
  technical: {label: 'Техническая блокировка', tone: 'technical', hard: true, active: true},
};

export const CONTACT_OUTCOMES = {
  reached: 'Дозвонился',
  no_answer: 'Не ответил',
  callback: 'Перезвонить',
  thinking: 'Клиент думает',
  declined: 'Отказ',
};

function deepClone(value) { return structuredClone(value); }
function nowIso() { return new Date().toISOString(); }
function memoryStorage() {
  const values = new Map();
  return {getItem:key => values.get(key) ?? null, setItem:(key,value) => values.set(key,value), removeItem:key => values.delete(key)};
}

export function isHardApplication(application) {
  return Boolean(STATUS[application.status]?.hard) && !application.isTest;
}

export function hasHardConflict(state, candidate, ignoreId = candidate.id) {
  if (candidate.isTest) return null;
  return state.applications.find(application =>
    application.id !== ignoreId &&
    application.apartmentId === candidate.apartmentId &&
    isHardApplication(application) &&
    overlaps(application.checkIn, application.checkOut, candidate.checkIn, candidate.checkOut)
  ) || null;
}

export function calculateRate(state, apartmentId, dateKey) {
  const apartment = state.apartments.find(item => item.id === apartmentId);
  if (!apartment) return 0;
  const override = state.priceOverrides
    .filter(item => item.apartmentId === apartmentId && dateKey >= item.start && dateKey < item.end)
    .at(-1);
  if (override) return override.price;
  return isWeekend(dateKey, state.workspace.weekendDays) ? apartment.weekendRate : apartment.weekdayRate;
}

export function calculateStayTotal(state, apartmentId, checkIn, checkOut) {
  const days = Math.max(1, dayDiff(checkIn, checkOut));
  let total = 0;
  for (let index = 0; index < days; index += 1) total += calculateRate(state, apartmentId, toDateKey(addDays(checkIn, index)));
  return total;
}

export function calculateBilling(state) {
  const activePoints = state.apartments.filter(item => item.active).length;
  const activeManagers = state.users.filter(item => item.active && item.role === 'manager').length;
  const extraOwners = Math.max(0, state.users.filter(item => item.active && item.role === 'owner').length - 1);
  const catalogPoints = state.apartments.filter(item => item.active && item.catalogEnabled).length;
  const b = state.billing;
  return {
    activePoints, activeManagers, extraOwners, catalogPoints,
    base: b.baseFee,
    points: activePoints * b.pointUnitPrice,
    managers: activeManagers * b.managerUnitPrice,
    owners: extraOwners * b.extraOwnerPrice,
    catalog: catalogPoints * b.catalogPointPrice,
    total: b.baseFee + activePoints*b.pointUnitPrice + activeManagers*b.managerUnitPrice + extraOwners*b.extraOwnerPrice + catalogPoints*b.catalogPointPrice,
  };
}

export function createStore(options = {}) {
  const storage = options.storage || globalThis.localStorage || memoryStorage();
  const saved = safeJsonParse(storage.getItem(STORAGE_KEY), null);
  let state = saved?.version === seedState.version ? saved : deepClone(seedState);
  const listeners = new Set();

  function persist() { storage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function emit(reason = 'update') {
    persist();
    for (const listener of listeners) listener(state, reason);
  }
  function mutate(reason, recipe) {
    recipe(state);
    emit(reason);
  }
  function actorName(userId = state.session.userId) { return state.users.find(user => user.id === userId)?.shortName || 'Пользователь'; }
  function addTimeline(application, type, text, actor = actorName()) {
    application.timeline ||= [];
    application.timeline.push({id: uid('tl'), type, text, actor, at: nowIso()});
    application.updatedAt = nowIso();
  }
  function notify(title, body, applicationId = null) {
    state.notifications.unshift({id:uid('notification'), title, body, applicationId, read:false, at:nowIso()});
  }

  function recomputeAlternatives() {
    const hard = state.applications.filter(isHardApplication);
    for (const application of state.applications) {
      if (application.isTest || !STATUS[application.status]?.active || isHardApplication(application)) {
        application.needsAlternative = false;
        continue;
      }
      application.needsAlternative = hard.some(booked => booked.apartmentId === application.apartmentId && overlaps(booked.checkIn, booked.checkOut, application.checkIn, application.checkOut));
    }
  }

  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    reset() { state = deepClone(seedState); emit('reset'); },
    replace(nextState) { state = deepClone(nextState); recomputeAlternatives(); emit('replace'); },
    setRoute(route) { mutate('route', s => { s.session.route = route; }); },
    setZoom(zoom) { mutate('zoom', s => { s.session.zoom = Number(zoom); }); },
    setShowTests(value) { mutate('tests', s => { s.session.showTests = Boolean(value); }); },
    setFilters(patch) { mutate('filters', s => { s.session.filters = {...s.session.filters, ...patch}; }); },
    switchUser(userId) {
      mutate('user', s => {
        const user = s.users.find(item => item.id === userId);
        if (!user) return;
        s.session.userId = user.id;
        s.session.role = user.role;
        if (user.role === 'superadmin') s.session.route = 'superadmin';
        else if (s.session.route === 'superadmin') s.session.route = 'calendar';
      });
    },
    markNotificationsRead() { mutate('notifications', s => s.notifications.forEach(item => { item.read = true; })); },
    createApplication(input, options = {}) {
      let created;
      mutate('application:create', s => {
        const userId = s.session.userId;
        const application = {
          id: uid('app'), externalId: options.externalId || `MAN-${Date.now().toString().slice(-6)}`,
          apartmentId: input.apartmentId, guestName: input.guestName?.trim() || '', phone: input.phone?.trim() || '',
          source: options.isTest ? `${input.source || 'Booking'} · Тест` : (input.source || 'Ручная'),
          status: options.technical ? 'technical' : (input.status || 'new'),
          checkIn: input.checkIn, checkOut: input.checkOut,
          checkInTime: input.checkInTime || '14:00', checkOutTime: input.checkOutTime || '12:00',
          total: Number(input.total || calculateStayTotal(s, input.apartmentId, input.checkIn, input.checkOut)),
          requiredPrepayment: Number(input.requiredPrepayment || 0), paid: 0, deposit: Number(input.deposit || 0),
          claimUserId: options.external ? null : userId, creditedManagerId: null,
          isTest: Boolean(options.isTest), needsAlternative: false, pinnedNote: input.pinnedNote || '',
          createdAt: nowIso(), updatedAt: nowIso(), comments: [], timeline: [],
        };
        if (STATUS[application.status]?.hard) {
          const conflict = hasHardConflict(s, application);
          if (conflict) throw new Error('HARD_CONFLICT');
        }
        addTimeline(application, 'created', options.isTest ? 'Тестовая заявка создана в симуляторе' : options.technical ? 'Создана техническая блокировка' : 'Ручная заявка создана и взята в работу');
        s.applications.unshift(application);
        notify(options.isTest ? 'Новая тестовая заявка' : options.technical ? 'Новая техническая блокировка' : 'Новая ручная заявка', `${application.guestName || 'Без имени'} · ${s.apartments.find(a => a.id === application.apartmentId)?.address || ''}`, application.id);
        created = application;
        recomputeAlternatives();
      });
      return created;
    },
    claimApplication(id) {
      let result;
      mutate('application:claim', s => {
        const application = s.applications.find(item => item.id === id);
        if (!application) throw new Error('NOT_FOUND');
        if (application.claimUserId && application.claimUserId !== s.session.userId) throw new Error('ALREADY_CLAIMED');
        application.claimUserId = s.session.userId;
        addTimeline(application, 'claim', `${actorName()} взял(а) заявку в работу`);
        result = application;
      });
      return result;
    },
    updateApplication(id, patch, timelineText = 'Данные заявки обновлены') {
      mutate('application:update', s => {
        const application = s.applications.find(item => item.id === id);
        if (!application) throw new Error('NOT_FOUND');
        Object.assign(application, patch);
        addTimeline(application, 'change', timelineText);
        recomputeAlternatives();
      });
    },
    setStatus(id, status) {
      let result;
      mutate('application:status', s => {
        const application = s.applications.find(item => item.id === id);
        if (!application || !STATUS[status]) throw new Error('INVALID_STATUS');
        const candidate = {...application, status};
        if (STATUS[status].hard) {
          const conflict = hasHardConflict(s, candidate, application.id);
          if (conflict) {
            const error = new Error('HARD_CONFLICT');
            error.conflict = conflict;
            throw error;
          }
        }
        const previous = application.status;
        application.status = status;
        if (!application.creditedManagerId && ['prepaid','paid'].includes(status)) application.creditedManagerId = application.claimUserId;
        addTimeline(application, 'status', `Статус: ${STATUS[previous]?.label || previous} → ${STATUS[status].label}`);
        if (['prepaid','paid'].includes(status)) notify(STATUS[status].label, `${application.guestName || application.phone} · ${application.paid.toLocaleString('ru-RU')} ₸`, application.id);
        recomputeAlternatives();
        result = application;
      });
      return result;
    },
    addContactOutcome(id, outcome, note = '', callbackAt = null) {
      mutate('application:contact', s => {
        const application = s.applications.find(item => item.id === id);
        if (!application) throw new Error('NOT_FOUND');
        const text = `${CONTACT_OUTCOMES[outcome] || outcome}${note ? `: ${note}` : ''}${callbackAt ? ` · перезвонить ${new Date(callbackAt).toLocaleString('ru-RU')}` : ''}`;
        addTimeline(application, 'contact', text);
        if (callbackAt) application.callbackAt = callbackAt;
      });
    },
    addComment(id, text) {
      if (!text?.trim()) return;
      mutate('application:comment', s => {
        const application = s.applications.find(item => item.id === id);
        application.comments ||= [];
        application.comments.push({id:uid('comment'), text:text.trim(), authorId:s.session.userId, at:nowIso()});
        addTimeline(application, 'comment', text.trim());
      });
    },
    setPinnedNote(id, text) {
      mutate('application:note', s => {
        const application = s.applications.find(item => item.id === id);
        application.pinnedNote = text.trim();
        addTimeline(application, 'change', text.trim() ? 'Важная заметка обновлена' : 'Важная заметка удалена');
      });
    },
    addPayment(id, paymentInput) {
      let payment;
      mutate('payment:create', s => {
        const application = s.applications.find(item => item.id === id);
        if (!application) throw new Error('NOT_FOUND');
        payment = {id:uid('payment'), applicationId:id, amount:Number(paymentInput.amount), kind:paymentInput.kind || 'rent', method:paymentInput.method || 'Kaspi', status:'confirmed', createdAt:nowIso(), createdBy:s.session.userId, note:paymentInput.note || ''};
        s.payments.push(payment);
        if (payment.kind === 'rent') application.paid = s.payments.filter(item => item.applicationId === id && item.kind === 'rent' && item.status === 'confirmed').reduce((sum,item) => sum + item.amount, 0);
        addTimeline(application, 'payment', `Подтверждён платёж ${payment.amount.toLocaleString('ru-RU')} ₸ · ${payment.method}`);
        notify('Платёж подтверждён', `${application.guestName || application.phone} · ${payment.amount.toLocaleString('ru-RU')} ₸`, application.id);
      });
      return payment;
    },
    addRefund(id, amount, reason = '') {
      mutate('refund:create', s => {
        const application = s.applications.find(item => item.id === id);
        const payment = {id:uid('refund'), applicationId:id, amount:-Math.abs(Number(amount)), kind:'rent', method:'Возврат', status:'confirmed', createdAt:nowIso(), createdBy:s.session.userId, note:reason};
        s.payments.push(payment);
        application.paid = s.payments.filter(item => item.applicationId === id && item.kind === 'rent' && item.status === 'confirmed').reduce((sum,item) => sum + item.amount, 0);
        addTimeline(application, 'payment', `Зафиксирован возврат ${Math.abs(payment.amount).toLocaleString('ru-RU')} ₸${reason ? ` · ${reason}` : ''}`);
      });
    },
    createCatalogLink(applicationId, apartmentIds) {
      let link;
      mutate('catalog:link', s => {
        const application = s.applications.find(item => item.id === applicationId);
        link = {id:uid('catalog'), token:uid('share').replaceAll('-','').slice(0,22), applicationId, apartmentIds, checkIn:application.checkIn, checkOut:application.checkOut, createdBy:s.session.userId, createdAt:nowIso(), expiresAt:new Date(Date.now()+s.settings.catalogDefaultExpiryHours*3_600_000).toISOString(), revoked:false};
        s.catalogLinks.unshift(link);
        addTimeline(application, 'change', `Отправлена подборка из ${apartmentIds.length} квартир`);
      });
      return link;
    },
    setPriceOverride(input) {
      mutate('price:override', s => { s.priceOverrides.push({id:uid('rate'), apartmentId:input.apartmentId, start:input.start, end:input.end, price:Number(input.price), reason:input.reason || ''}); });
    },
    updateApartment(id, patch) { mutate('apartment:update', s => Object.assign(s.apartments.find(item => item.id === id), patch)); },
    addUser(input) {
      mutate('user:add', s => s.users.push({id:uid('user'), name:input.name, shortName:input.name.split(' ')[0], initials:input.name.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase(), role:input.role || 'manager', active:true}));
    },
    deleteTestData() { mutate('tests:clear', s => { const ids = new Set(s.applications.filter(item => item.isTest).map(item=>item.id)); s.applications = s.applications.filter(item => !ids.has(item.id)); s.payments = s.payments.filter(item => !ids.has(item.applicationId)); s.notifications = s.notifications.filter(item => !ids.has(item.applicationId)); }); },
    exportCsv() {
      const header = ['id','external_id','apartment','guest_name','phone','source','status','check_in','check_out','total','paid','claim'];
      const rows = state.applications.filter(item => !item.isTest).map(application => {
        const apartment = state.apartments.find(item => item.id === application.apartmentId);
        const user = state.users.find(item => item.id === application.claimUserId);
        return [application.id, application.externalId, apartment?.address || '', application.guestName, application.phone, application.source, STATUS[application.status]?.label, application.checkIn, application.checkOut, application.total, application.paid, user?.name || ''].map(csvEscape).join(',');
      });
      return `\uFEFF${header.join(',')}\n${rows.join('\n')}`;
    },
    canEdit(application) {
      const user = state.users.find(item => item.id === state.session.userId);
      return user?.role === 'owner' || application.claimUserId === state.session.userId;
    },
    getRate: (apartmentId, dateKey) => calculateRate(state, apartmentId, dateKey),
    getBilling: () => calculateBilling(state),
    recomputeAlternatives() { mutate('application:alternatives', () => recomputeAlternatives()); },
  };
}

export const store = createStore();
