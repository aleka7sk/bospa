import {store, STATUS, CONTACT_OUTCOMES, calculateBilling, calculateRate, calculateStayTotal, isHardApplication} from './store.js';
import {mockRequestedEvent, toApplicationInput} from './connectivity.js';
import {icon} from './icons.js';
import {addDays, apartmentArtwork, clamp, dateRange, dayDiff, downloadText, escapeHtml, formatDate, formatMoney, formatPeriod, formatPhone, fromDateKey, initials, isToday, isWeekend, nights, overlaps, relativeTime, toDateKey, uid} from './utils.js';

const appRoot = document.querySelector('#app');
const portal = document.querySelector('#portal');
const ui = {
  overlay: null,
  selectedApplicationId: null,
  applicationTab: 'summary',
  applicationListTab: 'attention',
  search: '',
  sidebarOpen: false,
  notificationsOpen: false,
  userMenuOpen: false,
  calendarStart: toDateKey(addDays(new Date(), -35)),
  calendarCount: 140,
  calendarScrollLeft: null,
  calendarScrollTop: 0,
  calendarInitialized: false,
  pendingScrollShift: 0,
  selectedApartmentId: null,
  catalogSearch: '',
  toast: null,
  installPrompt: null,
};

const labels = {
  owner: 'Владелец', manager: 'Менеджер', superadmin: 'Superadmin',
};

const sourceTone = {Booking:'blue', Krisha:'amber', Instagram:'pink', WhatsApp:'green', Ручная:'neutral'};
const statusOrder = ['new','no_answer','thinking','awaiting_prepayment','prepaid','paid','completed','declined','unpaid','cancelled_client','cancelled_company'];
const softStatuses = new Set(['new','no_answer','thinking','awaiting_prepayment']);
const negativeStatuses = new Set(['declined','unpaid','cancelled_client','cancelled_company','duplicate','error']);

function state() { return store.getState(); }
function currentUser() { return state().users.find(user => user.id === state().session.userId); }
function apartmentById(id) { return state().apartments.find(item => item.id === id); }
function userById(id) { return state().users.find(item => item.id === id); }
function applicationById(id) { return state().applications.find(item => item.id === id); }
function statusMeta(status) { return STATUS[status] || {label: status, tone:'system', hard:false}; }
function canEdit(application) { return store.canEdit(application); }
function isOwner() { return ['owner','superadmin'].includes(currentUser()?.role); }
function todayKey() { return toDateKey(new Date()); }

function setRoute(route, pushHash = true) {
  store.setRoute(route);
  if (pushHash && location.hash !== `#${route}`) history.pushState(null, '', `#${route}`);
  ui.sidebarOpen = false;
  ui.userMenuOpen = false;
  render();
}

function routeFromHash() {
  const hash = location.hash.replace('#','');
  const valid = ['calendar','applications','my','analytics','catalog','more','superadmin'];
  if (hash === 'new') { ui.overlay = {type:'new-application'}; return 'calendar'; }
  return valid.includes(hash) ? hash : state().session.route || 'calendar';
}

function showToast(message, tone = 'success', duration = 2800) {
  ui.toast = {message, tone};
  renderPortal();
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { ui.toast = null; renderPortal(); }, duration);
}

function openOverlay(type, data = {}) {
  ui.overlay = {type, ...data};
  document.body.classList.add('overlay-open');
  renderPortal();
}

function closeOverlay() {
  ui.overlay = null;
  ui.applicationTab = 'summary';
  document.body.classList.remove('overlay-open');
  renderPortal();
}

function statusBadge(application, compact = false) {
  const meta = statusMeta(application.status);
  return `<span class="status-badge status-${meta.tone}${compact ? ' compact' : ''}">${application.isTest ? '<span class="test-dot"></span>' : ''}${escapeHtml(meta.label)}</span>`;
}

function sourceBadge(source) {
  const normalized = source?.replace(' · Тест','') || 'Ручная';
  return `<span class="source-badge source-${sourceTone[normalized] || 'neutral'}">${escapeHtml(source || 'Ручная')}</span>`;
}

function logoMarkup(compact = false) {
  return `<div class="brand${compact ? ' compact' : ''}"><span class="brand-mark">${icon('calendar', compact ? 18 : 22)}</span><span class="brand-word">bospa</span></div>`;
}

function navItems() {
  const role = currentUser()?.role;
  if (role === 'superadmin') return [
    ['superadmin','chart','Обзор'], ['calendar','calendar','Демо'], ['more','settings','Настройки'],
  ];
  if (role === 'manager') return [
    ['calendar','calendar','Календарь'], ['applications','inbox','Заявки'], ['my','user','Мои'], ['catalog','home','Каталог'], ['more','more','Ещё'],
  ];
  return [
    ['calendar','calendar','Календарь'], ['applications','inbox','Заявки'], ['analytics','chart','Аналитика'], ['catalog','home','Каталог'], ['more','more','Ещё'],
  ];
}

function renderSidebar() {
  const user = currentUser();
  const route = state().session.route;
  return `<aside class="sidebar ${ui.sidebarOpen ? 'open' : ''}">
    <div class="sidebar-head">${logoMarkup()}<button class="icon-button sidebar-close" data-action="toggle-sidebar" aria-label="Закрыть меню">${icon('close')}</button></div>
    <div class="workspace-chip"><span class="workspace-avatar">AA</span><span><strong>${escapeHtml(state().workspace.name)}</strong><small>${escapeHtml(state().workspace.city)} · ${state().apartments.filter(a=>a.active).length} квартир</small></span>${icon('chevronDown',16)}</div>
    <nav class="sidebar-nav">
      ${navItems().map(([key, navIcon, label]) => `<button class="nav-item ${route === key ? 'active' : ''}" data-route="${key}">${icon(navIcon,20)}<span>${label}</span>${key === 'applications' && attentionApplications().length ? `<b>${attentionApplications().length}</b>` : ''}</button>`).join('')}
    </nav>
    <div class="sidebar-section-label">Управление</div>
    <nav class="sidebar-nav secondary">
      ${user.role !== 'manager' ? `<button class="nav-item" data-action="open-pricing">${icon('tag',20)}<span>Цены</span></button><button class="nav-item" data-action="open-team">${icon('users',20)}<span>Команда</span></button><button class="nav-item" data-action="open-subscription">${icon('card',20)}<span>Подписка</span></button>` : ''}
      <button class="nav-item" data-action="open-test-center">${icon('spark',20)}<span>Test Center</span><em>Mock</em></button>
      <button class="nav-item" data-action="open-import">${icon('upload',20)}<span>Импорт</span></button>
    </nav>
    <div class="sidebar-spacer"></div>
    <div class="upgrade-card"><span class="upgrade-icon">${icon('spark',22)}</span><strong>Каталог активен</strong><p>${state().apartments.filter(a=>a.catalogEnabled).length} квартир доступны для подборок</p><button data-route="catalog">Открыть каталог</button></div>
    <button class="profile-row" data-action="toggle-user-menu"><span class="avatar">${escapeHtml(user.initials)}</span><span><strong>${escapeHtml(user.shortName)}</strong><small>${labels[user.role]}</small></span>${icon('chevronRight',17)}</button>
  </aside><div class="sidebar-backdrop ${ui.sidebarOpen ? 'show' : ''}" data-action="toggle-sidebar"></div>`;
}

function renderTopbar() {
  const unread = state().notifications.filter(item => !item.read).length;
  const route = state().session.route;
  const titles = {calendar:'Календарь',applications:'Заявки',my:'Мои заявки',analytics:'Аналитика',catalog:'Каталог квартир',more:'Управление',superadmin:'Bospa Platform'};
  return `<header class="topbar">
    <button class="icon-button menu-button" data-action="toggle-sidebar" aria-label="Меню">${icon('menu',22)}</button>
    <div class="mobile-brand">${logoMarkup(true)}</div>
    <div class="page-heading"><h1>${titles[route] || 'bospa'}</h1><span>${route === 'calendar' ? formatDate(new Date(), {month:'long', year:'numeric'}) : state().workspace.name}</span></div>
    <div class="topbar-actions">
      <label class="global-search">${icon('search',18)}<input type="search" data-input="global-search" value="${escapeHtml(ui.search)}" placeholder="Поиск квартиры, клиента, телефона…" /></label>
      <button class="icon-button" data-action="toggle-notifications" aria-label="Уведомления">${icon('bell',21)}${unread ? `<span class="notification-count">${unread}</span>` : ''}</button>
      <button class="avatar-button" data-action="toggle-user-menu"><span class="avatar">${escapeHtml(currentUser().initials)}</span><span class="avatar-meta"><strong>${escapeHtml(currentUser().shortName)}</strong><small>${labels[currentUser().role]}</small></span>${icon('chevronDown',15)}</button>
    </div>
  </header>`;
}

function renderBottomNav() {
  const route = state().session.route;
  return `<nav class="bottom-nav">${navItems().map(([key, navIcon, label]) => `<button class="bottom-nav-item ${route === key ? 'active' : ''}" data-route="${key}">${icon(navIcon,21)}<span>${label}</span>${key === 'applications' && attentionApplications().length ? `<b>${attentionApplications().length}</b>` : ''}</button>`).join('')}</nav>`;
}

function renderShell() {
  const route = state().session.route;
  return `<div class="app-shell">${renderSidebar()}<div class="main-shell">${renderTopbar()}<main class="main-content route-${route}">${renderRoute(route)}</main>${renderBottomNav()}<button class="global-fab" data-action="new-application" aria-label="Создать заявку">${icon('plus',26)}</button></div></div>`;
}

function renderRoute(route) {
  if (route === 'calendar') return renderCalendar();
  if (route === 'applications') return renderApplications();
  if (route === 'my') return renderMyApplications();
  if (route === 'analytics') return renderAnalytics();
  if (route === 'catalog') return renderCatalog();
  if (route === 'superadmin') return renderSuperadmin();
  return renderMore();
}

function filteredApplications({mine = false} = {}) {
  const s = state();
  const filters = s.session.filters;
  const q = ui.search.trim().toLowerCase();
  return s.applications.filter(application => {
    if (application.isTest && !s.session.showTests) return false;
    if (mine && application.claimUserId !== s.session.userId) return false;
    if (filters.quick === 'mine' && application.claimUserId !== s.session.userId) return false;
    if (filters.quick === 'new' && application.status !== 'new') return false;
    if (filters.quick === 'awaiting' && application.status !== 'awaiting_prepayment') return false;
    if (filters.quick === 'prepaid' && application.status !== 'prepaid') return false;
    if (filters.quick === 'paid' && application.status !== 'paid') return false;
    if (filters.status && application.status !== filters.status) return false;
    if (filters.source && application.source.replace(' · Тест','') !== filters.source) return false;
    if (filters.manager && application.claimUserId !== filters.manager) return false;
    if (filters.from && application.checkOut <= filters.from) return false;
    if (filters.to && application.checkIn >= filters.to) return false;
    if (q) {
      const apartment = apartmentById(application.apartmentId);
      const haystack = [application.guestName, application.phone, application.externalId, apartment?.address, apartment?.code].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function attentionApplications() {
  return state().applications.filter(application => !application.isTest && (application.needsAlternative || (!application.claimUserId && application.status === 'new') || (application.status === 'paid' && application.checkOut <= todayKey())));
}

function calendarApartments() {
  const q = ui.search.trim().toLowerCase();
  const visibleAppIds = new Set(filteredApplications().map(item => item.apartmentId));
  const quick = state().session.filters.quick;
  return state().apartments.filter(apartment => {
    if (!apartment.active) return false;
    if (q && ![apartment.address, apartment.code, apartment.complex, apartment.unit].join(' ').toLowerCase().includes(q) && !visibleAppIds.has(apartment.id)) return false;
    if (quick === 'free') {
      const from = state().session.filters.from || todayKey();
      const to = state().session.filters.to || toDateKey(addDays(from, state().session.zoom));
      return !state().applications.some(application => application.apartmentId === apartment.id && isHardApplication(application) && overlaps(application.checkIn, application.checkOut, from, to));
    }
    if (['new','awaiting','prepaid','paid','mine'].includes(quick) && !visibleAppIds.has(apartment.id)) return false;
    return true;
  });
}

function renderPageIntro(title, subtitle, actions = '') {
  return `<section class="page-intro"><div><h2>${title}</h2><p>${subtitle}</p></div><div class="page-actions">${actions}</div></section>`;
}

