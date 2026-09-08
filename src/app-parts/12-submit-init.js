async function handleSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const type = form.dataset.form;
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;

  try {
    if (type === 'login') {
      ui.busy = true;
      ui.authError = '';
      render();
      await backend.login(data.email, data.password);
      ui.busy = false;
      render();
      showToast('Добро пожаловать в bospa');
      return;
    }

    if (type === 'new-application') {
      if (data.checkOut <= data.checkIn) throw new Error('DATE');
      const created = await backend.createApplication(data, {isTest: Boolean(data.isTest)});
      closeOverlay();
      ui.selectedApplicationId = created.id;
      render();
      showToast(data.isTest ? 'Тестовая заявка создана' : 'Заявка создана и взята в работу');
      openApplication(created.id, true);
    } else if (type === 'test-application') {
      const eventPayload = mockRequestedEvent(data);
      const input = toApplicationInput(eventPayload, data.apartmentId);
      input.requiredPrepayment = Number(data.requiredPrepayment || 0);
      const created = await backend.createApplication(input, {
        isTest: true,
        external: true,
        externalId: eventPayload.payload.externalReservationId,
      });
      store.setShowTests(true);
      closeOverlay();
      render();
      showToast('Тестовое Booking-событие создано по v1alpha-контракту');
      openApplication(created.id);
    } else if (type === 'filters') {
      store.setFilters(data);
      closeOverlay();
      render();
    } else if (type === 'contact') {
      await backend.addContactOutcome(form.dataset.applicationId, data.outcome, data.note, data.callbackAt || null);
      closeOverlay();
      render();
      showToast('Результат контакта сохранён');
      openApplication(form.dataset.applicationId, true);
    } else if (type === 'payment') {
      await backend.addPayment(form.dataset.applicationId, data);
      const application = applicationById(form.dataset.applicationId);
      closeOverlay();
      render();
      showToast('Платёж подтверждён');
      if (application?.status === 'awaiting_prepayment' && application.paid >= application.requiredPrepayment) {
        showToast('Можно перевести заявку в «Предоплачено»');
      }
      openApplication(form.dataset.applicationId, true);
    } else if (type === 'refund') {
      await backend.addRefund(form.dataset.applicationId, data);
      closeOverlay();
      render();
      showToast('Возврат зафиксирован');
      openApplication(form.dataset.applicationId, true);
    } else if (type === 'note') {
      await backend.setPinnedNote(form.dataset.applicationId, data.note || '');
      closeOverlay();
      render();
      showToast('Важная заметка сохранена');
      openApplication(form.dataset.applicationId, true);
    } else if (type === 'edit-guest') {
      await backend.updateApplication(form.dataset.applicationId, {guestName: data.guestName || '', phone: data.phone});
      closeOverlay();
      render();
      showToast('Данные клиента обновлены');
      openApplication(form.dataset.applicationId, true);
    } else if (type === 'edit-stay') {
      if (data.checkOut <= data.checkIn) throw new Error('DATE');
      await backend.updateApplication(form.dataset.applicationId, {
        apartmentId: data.apartmentId,
        checkIn: data.checkIn,
        checkOut: data.checkOut,
        checkInTime: data.checkInTime,
        checkOutTime: data.checkOutTime,
        total: Number(data.total || 0),
        requiredPrepayment: Number(data.requiredPrepayment || 0),
        deposit: Number(data.deposit || 0),
      });
      closeOverlay();
      render();
      showToast('Квартира и период обновлены');
      openApplication(form.dataset.applicationId, true);
    } else if (type === 'comment') {
      await backend.addComment(form.dataset.applicationId, data.text);
      form.reset();
      renderPortal();
    } else if (type === 'complete') {
      await backend.setStatus(form.dataset.applicationId, 'completed');
      closeOverlay();
      render();
      showToast('Бронь завершена');
    } else if (type === 'catalog-link') {
      const selected = new FormData(form).getAll('apartments');
      if (!selected.length) throw new Error('EMPTY');
      const link = store.createCatalogLink(form.dataset.applicationId, selected);
      openOverlay('catalog-result', {linkId: link.id});
      render();
    } else if (type === 'price') {
      if (data.end <= data.start) throw new Error('DATE');
      store.setPriceOverride(data);
      closeOverlay();
      render();
      showToast(backend.isRemote() ? 'Цена сохранена локально; серверный Rate API подключается следующим модулем.' : 'Особая цена добавлена');
    } else if (type === 'add-user') {
      if (backend.isRemote()) throw new Error('REMOTE_UNSUPPORTED');
      store.addUser(data);
      form.reset();
      renderPortal();
      showToast('Пользователь добавлен');
    } else if (type === 'create-apartment') {
      const created = await backend.createApartment({...data, catalogEnabled: Boolean(data.catalogEnabled)});
      closeOverlay();
      render();
      showToast(`Квартира ${created.code} добавлена`);
    } else if (type === 'import') {
      showToast('Dry-run завершён: структура файлов принята');
      closeOverlay();
    } else if (type === 'price-book') {
      if (backend.isRemote()) throw new Error('REMOTE_UNSUPPORTED');
      Object.assign(state().billing, Object.fromEntries(
        Object.entries(data)
          .filter(([key]) => key in state().billing)
          .map(([key, value]) => [key, Number(value)]),
      ));
      store.replace(state());
      closeOverlay();
      render();
      showToast('Новая версия price book создана');
    }
  } catch (error) {
    if (type === 'login') {
      ui.busy = false;
      ui.authError = backend.describeError(error);
      render();
    } else {
      const message = error.message === 'DATE'
        ? 'Проверьте период: выезд должен быть позже заезда.'
        : error.message === 'EMPTY'
          ? 'Выберите хотя бы одну квартиру.'
          : error.message === 'REMOTE_UNSUPPORTED'
            ? 'Этот серверный модуль ещё не подключён.'
            : backend.describeError(error);
      showToast(message, 'error', 4400);
      if (error?.code === 'conflict' && form.dataset.applicationId) {
        await backend.loadApplicationDetail(form.dataset.applicationId).catch(() => {});
        renderPortal();
      }
    }
  } finally {
    if (submit && submit.isConnected) submit.disabled = false;
  }
}

async function handleNextAction(id, next) {
  if (next === 'claim') {
    try {
      await backend.claimApplication(id);
      showToast('Заявка взята в работу');
      openApplication(id, true);
    } catch (error) { showRuntimeError(error, 'Другой менеджер уже взял заявку.'); }
    return;
  }
  if (next === 'contact') { openOverlay('contact', {applicationId: id}); return; }
  if (next === 'alternative') { openOverlay('catalog-link', {applicationId: id}); return; }
  if (next === 'send-payment') { await sendPaymentMessage(id); return; }
  if (next === 'add-payment') { openOverlay('payment', {applicationId: id}); return; }
  if (next === 'set-prepaid') { await changeStatus(id, 'prepaid'); return; }
  if (next === 'set-paid') { await changeStatus(id, 'paid'); return; }
  if (next === 'complete') { openOverlay('complete', {applicationId: id}); return; }
  if (next === 'details') { showToast('Бронь оплачена и ожидает даты выезда'); return; }
  openOverlay('status', {applicationId: id});
}

async function handleContactAction(id, kind) {
  let application = applicationById(id);
  if (!application) return;
  if (!application.claimUserId) {
    if (!confirm('Взять заявку в работу и продолжить контакт?')) return;
    try {
      await backend.claimApplication(id);
      application = applicationById(id);
    } catch (error) {
      showRuntimeError(error, 'Заявку уже взял другой менеджер.');
      return;
    }
  }
  if (application.claimUserId !== state().session.userId && currentUser().role !== 'owner'
      && !confirm(`Заявка уже в работе у ${userById(application.claimUserId)?.shortName || 'коллеги'}. Контакт может дублировать общение. Продолжить?`)) return;

  try {
    if (kind === 'call') {
      await backend.addContactOutcome(id, 'reached', 'Инициирован звонок из карточки');
      location.href = `tel:${application.phone.replace(/\s/g, '')}`;
    } else {
      await backend.addContactOutcome(id, 'reached', 'Открыт WhatsApp из карточки');
      const digits = application.phone.replace(/\D/g, '');
      window.open(`https://wa.me/${digits}`, '_blank', 'noopener');
    }
    render();
  } catch (error) { showRuntimeError(error, 'Не удалось сохранить контакт.'); }
}

async function changeStatus(id, status) {
  try {
    const application = await backend.setStatus(id, status);
    closeOverlay();
    render();
    showToast(`Статус: ${STATUS[status].label}`);
    openApplication(application.id, true);
  } catch (error) {
    showRuntimeError(error, 'Не удалось изменить статус.');
    if (error?.code === 'conflict') {
      await backend.loadApplicationDetail(id).catch(() => {});
      renderPortal();
    }
  }
}

async function sendPaymentMessage(id) {
  const application = applicationById(id);
  const amount = Math.max(0, (application.status === 'awaiting_prepayment' ? application.requiredPrepayment : application.total) - application.paid);
  const text = `Здравствуйте${application.guestName ? `, ${application.guestName}` : ''}! Для подтверждения брони внесите ${formatMoney(amount)} через Kaspi: ${state().workspace.kaspiLink}. После оплаты отправьте чек в этот чат.`;
  await shareText(text);
  try {
    await backend.addContactOutcome(id, 'reached', 'Подготовлено сообщение с Kaspi-ссылкой');
  } catch (error) { showRuntimeError(error, 'Сообщение подготовлено, но запись в историю не сохранилась.'); }
  showToast('Сообщение об оплате подготовлено');
}

async function shareText(text) {
  try {
    if (navigator.share) await navigator.share({title: 'bospa', text});
    else {
      await navigator.clipboard.writeText(text);
      showToast('Сообщение скопировано');
    }
  } catch (error) {
    if (error.name !== 'AbortError') showToast('Не удалось открыть меню отправки', 'error');
  }
}

function downloadApartmentsTemplate() {
  const content = 'external_key,address,unit,city,district,complex,check_in,check_out,weekday_rate,weekend_rate,active,public_code,note\nAPT-001,"Нестеров 1",7,Астана,Есиль,"Нестеров",14:00,12:00,26000,32000,true,BAISANAT,""';
  downloadText('bospa-apartments-template.csv', `\uFEFF${content}`, 'text/csv;charset=utf-8');
  showToast('Шаблон квартир скачан');
}

function downloadBookingsTemplate() {
  const content = 'external_key,apartment_external_key,check_in,check_out,phone,guest_name,status,source,total,required_prepayment,paid,deposit,manager,note\nBOOK-001,APT-001,2026-09-10,2026-09-13,+77000000000,Алия,new,manual,78000,20000,0,20000,,""';
  downloadText('bospa-bookings-template.csv', `\uFEFF${content}`, 'text/csv;charset=utf-8');
  showToast('Шаблон броней скачан');
}

function registerPwa() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); ui.installPrompt = event; });
}

async function startApplication() {
  registerPwa();
  render();
  await backend.initialize();
  render();
}

store.subscribe((_state, reason) => {
  if (!['route', 'zoom', 'filters', 'user'].includes(reason)) render();
});
window.addEventListener('hashchange', () => render());
window.addEventListener('online', () => { if (backend.isRemote()) refreshRemoteData({silent: true}); });
window.addEventListener('offline', () => {
  if (!backend.isRemote()) return;
  const next = structuredClone(state());
  next.runtime = {...(next.runtime || {}), online: false};
  store.replace(next);
});
document.addEventListener('click', event => {
  if (event.target.matches('.overlay-backdrop') || event.target.closest('[data-action],[data-route],[data-zoom],[data-quick-filter],[data-application-list-tab],[data-application-tab],[data-switch-user],[data-copy],[data-share-text]')) {
    void handleClick(event);
  }
});
document.addEventListener('change', handleChange);
document.addEventListener('input', handleInput);
document.addEventListener('submit', event => { void handleSubmit(event); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (ui.overlay) closeOverlay();
    else if (ui.notificationsOpen || ui.userMenuOpen) {
      ui.notificationsOpen = false;
      ui.userMenuOpen = false;
      renderPortal();
    }
  }
});
document.addEventListener('click', event => {
  if (ui.notificationsOpen && !event.target.closest('.notification-popover') && !event.target.closest('[data-action="toggle-notifications"]')) {
    ui.notificationsOpen = false;
    renderPortal();
  }
  if (ui.userMenuOpen && !event.target.closest('.user-popover') && !event.target.closest('[data-action="toggle-user-menu"]')) {
    ui.userMenuOpen = false;
    renderPortal();
  }
});

void startApplication();
