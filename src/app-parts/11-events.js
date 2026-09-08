function render() {
  if (backend.status === 'booting') {
    appRoot.innerHTML = renderBootScreen();
    portal.innerHTML = '';
    return;
  }
  if (backend.status === 'anonymous') {
    appRoot.innerHTML = renderLoginScreen();
    renderPortal();
    return;
  }
  if (backend.isRemote() && state().apartments.length === 0) {
    appRoot.innerHTML = renderOnboarding();
    renderPortal();
    return;
  }
  const route = routeFromHash();
  if (route !== state().session.route) store.setRoute(route);
  appRoot.innerHTML = renderShell();
  renderPortal();
  restoreCalendarPosition();
}

function restoreCalendarPosition() {
  const scroller = document.querySelector('#calendar-scroll');
  if (!scroller) return;
  const width = state().session.zoom === 7 ? 44 : state().session.zoom === 2 ? 142 : 76;
  if (ui.calendarScrollLeft === null) {
    ui.calendarScrollLeft = Math.max(0, (dayDiff(ui.calendarStart, todayKey()) - 1) * width);
  }
  requestAnimationFrame(() => {
    scroller.scrollLeft = ui.calendarScrollLeft + ui.pendingScrollShift;
    scroller.scrollTop = ui.calendarScrollTop;
    ui.pendingScrollShift = 0;
  });
  scroller.addEventListener('scroll', () => {
    ui.calendarScrollLeft = scroller.scrollLeft;
    ui.calendarScrollTop = scroller.scrollTop;
    if (scroller.scrollLeft < width * 6) {
      ui.calendarStart = toDateKey(addDays(ui.calendarStart, -30));
      ui.calendarCount += 30;
      ui.pendingScrollShift = 30 * width;
      render();
    } else if (scroller.scrollLeft > scroller.scrollWidth - scroller.clientWidth - width * 8) {
      ui.calendarCount += 30;
      render();
    }
  }, {passive: true});
}

function captureCalendarPosition() {
  const scroller = document.querySelector('#calendar-scroll');
  if (scroller) {
    ui.calendarScrollLeft = scroller.scrollLeft;
    ui.calendarScrollTop = scroller.scrollTop;
  }
}

function showRuntimeError(error, fallback = 'Не удалось выполнить действие.') {
  const message = backend.describeError(error) || fallback;
  showToast(message, 'error', 4200);
  if (backend.status === 'anonymous') render();
}

async function refreshRemoteData({silent = false} = {}) {
  if (!backend.isRemote()) return;
  try {
    await backend.refresh();
    render();
    if (!silent) showToast('Данные обновлены');
  } catch (error) {
    showRuntimeError(error, 'Не удалось обновить данные.');
  }
}

function openApplication(id, full = false) {
  ui.selectedApplicationId = id;
  openOverlay(full ? 'full-application' : 'quick-application', {applicationId: id});
  if (backend.isRemote()) {
    backend.loadApplicationDetail(id)
      .then(() => renderPortal())
      .catch(error => showRuntimeError(error, 'Не удалось загрузить карточку.'));
  }
}

async function handleClick(event) {
  const target = event.target.closest('[data-action],[data-route],[data-zoom],[data-quick-filter],[data-application-list-tab],[data-application-tab],[data-switch-user],[data-copy],[data-share-text]');
  if (!target) return;
  if (target.matches('[data-overlay-panel]')) return;

  const route = target.dataset.route;
  if (route) { setRoute(route); return; }
  if (target.dataset.zoom) { captureCalendarPosition(); store.setZoom(Number(target.dataset.zoom)); render(); return; }
  if (target.dataset.quickFilter) { store.setFilters({quick: target.dataset.quickFilter}); render(); return; }
  if (target.dataset.applicationListTab) { ui.applicationListTab = target.dataset.applicationListTab; render(); return; }
  if (target.dataset.applicationTab) { ui.applicationTab = target.dataset.applicationTab; renderPortal(); return; }
  if (target.dataset.switchUser) {
    if (!backend.isDemo()) return;
    store.switchUser(target.dataset.switchUser);
    ui.userMenuOpen = false;
    render();
    showToast(`Роль: ${labels[currentUser().role]}`);
    return;
  }
  if (target.dataset.copy !== undefined) {
    navigator.clipboard?.writeText(target.dataset.copy).then(() => showToast('Скопировано'));
    return;
  }
  if (target.dataset.shareText !== undefined) { shareText(target.dataset.shareText); return; }

  const action = target.dataset.action;
  if (action === 'toggle-password') {
    const input = target.closest('.password-field')?.querySelector('input');
    if (input) input.type = input.type === 'password' ? 'text' : 'password';
    return;
  }
  if (action === 'enter-demo') { ui.authError = ''; backend.enterDemo(); render(); return; }
  if (action === 'retry-api') { ui.authError = ''; await backend.retry(); render(); return; }
  if (action === 'logout') {
    ui.userMenuOpen = false;
    await backend.logout();
    render();
    return;
  }
  if (action === 'refresh-server') { await refreshRemoteData(); return; }
  if (action === 'toggle-sidebar') { ui.sidebarOpen = !ui.sidebarOpen; render(); return; }
  if (action === 'toggle-notifications') { ui.notificationsOpen = !ui.notificationsOpen; ui.userMenuOpen = false; renderPortal(); return; }
  if (action === 'toggle-user-menu') { ui.userMenuOpen = !ui.userMenuOpen; ui.notificationsOpen = false; renderPortal(); return; }
  if (action === 'close-overlay') { closeOverlay(); return; }
  if (action === 'new-application') { openOverlay('new-application'); return; }
  if (action === 'new-at-date') { openOverlay('new-application', {apartmentId: target.dataset.apartmentId, date: target.dataset.date}); return; }
  if (action === 'new-at-apartment') { openOverlay('new-application', {apartmentId: target.dataset.apartmentId}); return; }
  if (action === 'open-application') { openApplication(target.dataset.applicationId); return; }
  if (action === 'full-application') { openApplication(target.dataset.applicationId, true); return; }
  if (action === 'apartment-details' || action === 'edit-apartment') { openOverlay('apartment', {apartmentId: target.dataset.apartmentId}); return; }
  if (action === 'open-apartments') { openOverlay('apartments'); return; }
  if (action === 'create-apartment' || action === 'add-first-apartment') { openOverlay('create-apartment'); return; }
  if (action === 'edit-guest') { openOverlay('edit-guest', {applicationId: target.dataset.applicationId}); return; }
  if (action === 'edit-stay') { openOverlay('edit-stay', {applicationId: target.dataset.applicationId}); return; }
  if (action === 'today') {
    const width = state().session.zoom === 7 ? 44 : state().session.zoom === 2 ? 142 : 76;
    ui.calendarScrollLeft = Math.max(0, (dayDiff(ui.calendarStart, todayKey()) - 1) * width);
    ui.calendarScrollTop = 0;
    restoreCalendarPosition();
    return;
  }
  if (action === 'open-filters') { openOverlay('filters'); return; }
  if (action === 'clear-filters') { store.setFilters({quick: 'all', status: '', source: '', manager: '', from: '', to: ''}); closeOverlay(); render(); return; }
  if (action === 'claim') {
    try {
      await backend.claimApplication(target.dataset.applicationId);
      showToast('Заявка взята в работу');
      openApplication(target.dataset.applicationId, true);
    } catch (error) { showRuntimeError(error, 'Заявку уже взял другой менеджер.'); }
    return;
  }
  if (action === 'call' || action === 'whatsapp') { await handleContactAction(target.dataset.applicationId, action); return; }
  if (action === 'next-action') { await handleNextAction(target.dataset.applicationId, target.dataset.next); return; }
  if (action === 'add-payment') { openOverlay('payment', {applicationId: target.dataset.applicationId}); return; }
  if (action === 'add-refund') { openOverlay('refund', {applicationId: target.dataset.applicationId}); return; }
  if (action === 'send-payment') { await sendPaymentMessage(target.dataset.applicationId); return; }
  if (action === 'edit-note') { openOverlay('note', {applicationId: target.dataset.applicationId}); return; }
  if (action === 'clear-note') {
    try {
      await backend.setPinnedNote(target.dataset.applicationId, '');
      showToast('Заметка удалена');
      openApplication(target.dataset.applicationId, true);
    } catch (error) { showRuntimeError(error); }
    return;
  }
  if (action === 'choose-status') { await changeStatus(target.dataset.applicationId, target.dataset.status); return; }
  if (action === 'open-overlap-list') {
    const apps = state().applications.filter(item => item.apartmentId === target.dataset.apartmentId && STATUS[item.status]?.active);
    if (apps[0]) { ui.applicationListTab = 'active'; setRoute('applications'); }
    return;
  }
  if (action === 'filter-attention') { ui.applicationListTab = 'attention'; setRoute('applications'); return; }
  if (action === 'open-pricing' || action === 'open-price') { openOverlay('pricing'); return; }
  if (action === 'open-team') { openOverlay('team'); return; }
  if (action === 'open-subscription') { openOverlay('subscription'); return; }
  if (action === 'open-test-center' || action === 'open-test') { openOverlay('test-center'); return; }
  if (action === 'open-import') { openOverlay('import'); return; }
  if (action === 'open-backup' || action === 'export-csv') {
    downloadText(`bospa-applications-${todayKey()}.csv`, store.exportCsv(), 'text/csv;charset=utf-8');
    showToast('CSV подготовлен');
    return;
  }
  if (action === 'open-settings') { showToast('Настройки безопасности подготовлены в PRD'); return; }
  if (action === 'preview-catalog') { openOverlay('preview-catalog'); return; }
  if (action === 'create-catalog-link') {
    const application = applicationById(ui.selectedApplicationId)
      || state().applications.find(item => item.needsAlternative)
      || state().applications.find(item => item.claimUserId === state().session.userId);
    if (application) openOverlay('catalog-link', {applicationId: application.id});
    else showToast('Сначала выберите заявку', 'error');
    return;
  }
  if (action === 'clear-tests') {
    if (backend.isRemote()) {
      showToast('Очистка серверных тестов появится после отдельного подтверждения владельца.', 'error');
    } else {
      store.deleteTestData(); closeOverlay(); render(); showToast('Тестовые данные очищены');
    }
    return;
  }
  if (action === 'reset-demo') {
    if (backend.isDemo() && confirm('Сбросить все локальные изменения и вернуть демо-данные?')) {
      store.reset(); ui.userMenuOpen = false; closeOverlay(); render(); showToast('Демо восстановлено');
    }
    return;
  }
  if (action === 'mark-notifications') { store.markNotificationsRead(); render(); return; }
  if (action === 'notification-open') {
    ui.notificationsOpen = false;
    if (target.dataset.applicationId) openApplication(target.dataset.applicationId, true);
    return;
  }
  if (action === 'download-apartments-template') { downloadApartmentsTemplate(); return; }
  if (action === 'download-bookings-template') { downloadBookingsTemplate(); return; }
  if (action === 'open-price-book') { openOverlay('price-book'); return; }
  if (action === 'request-transfer') { showToast('Запрос на передачу отправлен владельцу'); return; }
}

function handleChange(event) {
  const target = event.target;
  if (target.dataset.actionChange === 'toggle-tests') { store.setShowTests(target.checked); render(); return; }
  if (target.dataset.toggleApartmentPublished) {
    if (backend.isRemote()) {
      target.checked = !target.checked;
      showToast('Серверное редактирование каталога будет подключено отдельным endpoint.', 'error');
      return;
    }
    store.updateApartment(target.dataset.toggleApartmentPublished, {published: target.checked});
    showToast(target.checked ? 'Квартира опубликована' : 'Квартира скрыта');
    render();
  }
}

function handleInput(event) {
  const target = event.target;
  if (target.dataset.input === 'global-search') {
    ui.search = target.value;
    clearTimeout(handleInput.timer);
    handleInput.timer = setTimeout(render, 160);
    return;
  }
  if (target.dataset.input === 'catalog-search') {
    ui.catalogSearch = target.value;
    clearTimeout(handleInput.catalogTimer);
    handleInput.catalogTimer = setTimeout(render, 160);
  }
}
