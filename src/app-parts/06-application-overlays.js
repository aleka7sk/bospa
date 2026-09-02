function renderPortal() {
  portal.innerHTML = `${ui.overlay ? renderOverlay(ui.overlay) : ''}${ui.notificationsOpen ? renderNotifications() : ''}${ui.userMenuOpen ? renderUserMenu() : ''}${ui.toast ? `<div class="toast ${ui.toast.tone}">${icon(ui.toast.tone==='error'?'alert':'check',18)}<span>${escapeHtml(ui.toast.message)}</span></div>` : ''}`;
  if (ui.overlay) setTimeout(()=>portal.querySelector('input:not([type=hidden]),textarea,select')?.focus({preventScroll:true}),50);
}

function renderOverlay(overlay) {
  if (overlay.type === 'quick-application') return renderQuickApplication(overlay.applicationId);
  if (overlay.type === 'full-application') return renderFullApplication(overlay.applicationId);
  if (overlay.type === 'new-application') return renderNewApplicationModal(overlay);
  if (overlay.type === 'filters') return renderFiltersModal();
  if (overlay.type === 'contact') return renderContactModal(overlay.applicationId);
  if (overlay.type === 'payment') return renderPaymentModal(overlay.applicationId);
  if (overlay.type === 'note') return renderNoteModal(overlay.applicationId);
  if (overlay.type === 'status') return renderStatusModal(overlay.applicationId);
  if (overlay.type === 'complete') return renderCompleteModal(overlay.applicationId);
  if (overlay.type === 'catalog-link') return renderCatalogLinkModal(overlay.applicationId);
  if (overlay.type === 'catalog-result') return renderCatalogResultModal(overlay.linkId);
  if (overlay.type === 'test-center') return renderTestCenterModal();
  if (overlay.type === 'pricing') return renderPricingModal();
  if (overlay.type === 'team') return renderTeamModal();
  if (overlay.type === 'subscription') return renderSubscriptionModal();
  if (overlay.type === 'import') return renderImportModal();
  if (overlay.type === 'apartment') return renderApartmentModal(overlay.apartmentId);
  if (overlay.type === 'preview-catalog') return renderPublicCatalogPreview();
  if (overlay.type === 'price-book') return renderPriceBookModal();
  return '';
}

function overlayFrame(content, {kind='modal',wide=false,full=false,label='Диалог'}={}) {
  return `<div class="overlay-backdrop" data-action="close-overlay"><section class="overlay-panel ${kind} ${wide?'wide':''} ${full?'full':''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(label)}" data-overlay-panel>${content}</section></div>`;
}

function renderQuickApplication(id) {
  const application=applicationById(id); if(!application)return '';
  const apartment=apartmentById(application.apartmentId); const claim=userById(application.claimUserId); const editable=canEdit(application); const next=nextAction(application);
  return overlayFrame(`<div class="sheet-handle"></div><div class="quick-sheet-head"><div><div class="badge-row">${statusBadge(application)}${sourceBadge(application.source)}${application.needsAlternative?'<span class="attention-badge">Нужна альтернатива</span>':''}</div><h2>${escapeHtml(application.guestName||'Имя не указано')}</h2><a href="tel:${application.phone.replace(/\s/g,'')}">${formatPhone(application.phone)}</a></div><button class="icon-button" data-action="close-overlay">${icon('close')}</button></div>
    ${application.pinnedNote?`<div class="pinned-note">${icon('pin',17)}<span>${escapeHtml(application.pinnedNote)}</span></div>`:''}
    <div class="quick-info-grid"><div><small>Квартира</small><strong>${escapeHtml(apartment?.address||'—')}</strong></div><div><small>Период</small><strong>${formatPeriod(application.checkIn,application.checkOut)}</strong><span>${application.checkInTime} → ${application.checkOutTime}</span></div><div><small>В работе</small><strong>${claim?escapeHtml(claim.name):'Свободная заявка'}</strong></div><div><small>Источник</small><strong>${escapeHtml(application.source)}</strong><span>${escapeHtml(application.externalId)}</span></div></div>
    <div class="money-summary"><div><small>Стоимость</small><strong>${formatMoney(application.total)}</strong></div><div><small>Получено</small><strong class="positive-text">${formatMoney(application.paid)}</strong></div><div><small>Остаток</small><strong>${formatMoney(Math.max(0,application.total-application.paid))}</strong></div><div><small>Предоплата</small><strong>${formatMoney(application.requiredPrepayment)}</strong></div><span class="money-progress"><i style="width:${Math.min(100,application.paid/Math.max(1,application.total)*100)}%"></i></span></div>
    <button class="details-link" data-action="full-application" data-application-id="${application.id}">Открыть подробную карточку ${icon('chevronRight',17)}</button>
    ${renderStickyActions(application,editable,next,true)}`, {kind:'bottom-sheet',label:'Быстрая карточка заявки'});
}

function renderFullApplication(id) {
  const application=applicationById(id); if(!application)return '';
  const apartment=apartmentById(application.apartmentId); const claim=userById(application.claimUserId); const editable=canEdit(application); const next=nextAction(application);
  const tabs=[['summary','Обзор'],['payments','Платежи'],['timeline','История']];
  return overlayFrame(`<header class="full-card-head"><button class="icon-button" data-action="close-overlay">${icon('chevronLeft',22)}</button><div><span>${escapeHtml(application.externalId)}</span><h2>${escapeHtml(application.guestName||'Имя не указано')}</h2></div><button class="icon-button" data-action="application-menu">${icon('dots',22)}</button></header>
    <div class="full-card-scroll"><div class="application-hero"><div class="badge-row">${statusBadge(application)}${sourceBadge(application.source)}${application.isTest?'<span class="test-badge">Тест</span>':''}${application.needsAlternative?'<span class="attention-badge">Нужна альтернатива</span>':''}</div><div class="guest-contact"><div class="avatar large">${initials(application.guestName)}</div><div><h3>${escapeHtml(application.guestName||'Имя не указано')}</h3><a href="tel:${application.phone.replace(/\s/g,'')}">${formatPhone(application.phone)}</a></div>${editable?`<button class="icon-button" data-action="edit-guest" data-application-id="${application.id}">${icon('edit',17)}</button>`:''}</div>${application.pinnedNote?`<div class="pinned-note">${icon('pin',17)}<span>${escapeHtml(application.pinnedNote)}</span>${editable?`<button data-action="edit-note" data-application-id="${application.id}">${icon('edit',15)}</button>`:''}</div>`:editable?`<button class="add-note" data-action="edit-note" data-application-id="${application.id}">${icon('pin',16)}Закрепить важную заметку</button>`:''}</div>
    <nav class="application-tabs">${tabs.map(([key,label])=>`<button class="${ui.applicationTab===key?'active':''}" data-application-tab="${key}">${label}${key==='payments'?`<b>${state().payments.filter(p=>p.applicationId===id).length}</b>`:''}</button>`).join('')}</nav>
    ${ui.applicationTab==='summary'?renderApplicationSummary(application,apartment,claim,editable):ui.applicationTab==='payments'?renderPaymentsSection(application,editable):renderTimeline(application)}
    </div>${renderStickyActions(application,editable,next,false)}`, {kind:'side-sheet',full:true,label:'Карточка заявки'});
}

function renderApplicationSummary(application,apartment,claim,editable) {
  const comments=[...(application.comments||[])].sort((a,b)=>b.at.localeCompare(a.at));
  return `<div class="application-section-stack">
    <section class="detail-section"><div class="section-head"><div><h3>Проживание</h3><p>${nights(application.checkIn,application.checkOut)} ночей</p></div>${editable?`<button class="text-button" data-action="edit-stay" data-application-id="${application.id}">Изменить</button>`:''}</div><div class="stay-card"><div><span class="detail-icon">${icon('building',18)}</span><span><small>Квартира</small><strong>${escapeHtml(apartment?.address||'—')}</strong><em>${escapeHtml(apartment?.district||'')}</em></span></div><div><span class="detail-icon">${icon('calendar',18)}</span><span><small>Заезд</small><strong>${formatDate(application.checkIn)}</strong><em>${application.checkInTime}</em></span></div><div><span class="detail-icon">${icon('calendar',18)}</span><span><small>Выезд</small><strong>${formatDate(application.checkOut)}</strong><em>${application.checkOutTime}</em></span></div></div></section>
    <section class="detail-section"><div class="section-head"><div><h3>Финансы</h3><p>Подтверждённые операции</p></div><button class="text-button" data-application-tab="payments">Все платежи</button></div>${renderFinancialSummary(application)}</section>
    <section class="detail-section"><div class="section-head"><div><h3>Сопровождение</h3><p>Claim определяет право редактирования</p></div></div><div class="claim-card"><span class="avatar">${claim?claim.initials:'—'}</span><div><small>${claim?'В работе у':'Заявка свободна'}</small><strong>${claim?escapeHtml(claim.name):'Никто не взял'}</strong>${application.creditedManagerId?`<em>Продажа: ${escapeHtml(userById(application.creditedManagerId)?.shortName||'—')}</em>`:''}</div>${!application.claimUserId?`<button class="button primary small" data-action="claim" data-application-id="${application.id}">Взять</button>`:editable&&currentUser().role==='manager'?`<button class="button tertiary small" data-action="request-transfer" data-application-id="${application.id}">Передать</button>`:''}</div></section>
    <section class="detail-section"><div class="section-head"><div><h3>Комментарии</h3><p>Видны всей команде</p></div></div><form class="comment-form" data-form="comment" data-application-id="${application.id}"><textarea name="text" rows="2" placeholder="Добавить комментарий…"></textarea><button class="icon-button primary-icon" type="submit">${icon('plus',19)}</button></form><div class="comments-list">${comments.map(comment=>`<div><span class="avatar tiny">${userById(comment.authorId)?.initials||'—'}</span><p><strong>${escapeHtml(userById(comment.authorId)?.shortName||'Пользователь')}</strong><span>${escapeHtml(comment.text)}</span><small>${relativeTime(comment.at)}</small></p></div>`).join('')||'<p class="muted-empty">Комментариев пока нет</p>'}</div></section>
  </div>`;
}

function renderFinancialSummary(application) {
  const percent=Math.min(100,application.paid/Math.max(1,application.total)*100);
  return `<div class="financial-card"><div class="finance-primary"><span><small>Стоимость</small><strong>${formatMoney(application.total)}</strong></span><span><small>Получено</small><strong class="positive-text">${formatMoney(application.paid)}</strong></span></div><div class="finance-progress"><i style="width:${percent}%"></i></div><div class="finance-secondary"><span><small>Предоплата</small><strong>${formatMoney(application.requiredPrepayment)}</strong></span><span><small>Остаток</small><strong>${formatMoney(Math.max(0,application.total-application.paid))}</strong></span><span><small>Депозит</small><strong>${formatMoney(application.deposit)}</strong></span></div></div>`;
}

function renderPaymentsSection(application,editable) {
  const payments=state().payments.filter(p=>p.applicationId===application.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  return `<div class="application-section-stack"><section class="detail-section">${renderFinancialSummary(application)}${editable?`<div class="payment-actions"><button class="button primary" data-action="add-payment" data-application-id="${application.id}">${icon('plus',18)}Подтвердить платёж</button><button class="button secondary" data-action="send-payment" data-application-id="${application.id}">${icon('share',18)}Запросить оплату</button></div>`:''}</section><section class="detail-section"><div class="section-head"><div><h3>История операций</h3><p>Чек сам по себе не увеличивает полученную сумму</p></div></div><div class="payments-list">${payments.map(payment=>`<div class="payment-item ${payment.amount<0?'refund':''}"><span class="payment-icon">${icon(payment.amount<0?'refresh':'wallet',18)}</span><div><strong>${payment.amount<0?'Возврат':'Платёж'} · ${escapeHtml(payment.method)}</strong><span>${payment.kind==='deposit'?'Депозит':'Аренда'}${payment.note?` · ${escapeHtml(payment.note)}`:''}</span><small>${new Date(payment.createdAt).toLocaleString('ru-RU')} · ${escapeHtml(userById(payment.createdBy)?.shortName||'')}</small></div><b>${payment.amount<0?'−':'+'}${formatMoney(Math.abs(payment.amount))}</b></div>`).join('')||renderEmptyState('wallet','Операций пока нет','Добавьте подтверждённый платёж после проверки поступления.')}</div></section></div>`;
}

function renderTimeline(application) {
  const events=[...(application.timeline||[])].sort((a,b)=>b.at.localeCompare(a.at));
  return `<section class="detail-section timeline-section"><div class="timeline-filters"><button class="active">Все</button><button>Контакты</button><button>Статусы</button><button>Платежи</button><button>Изменения</button></div><div class="timeline">${events.map(event=>`<div class="timeline-item"><span class="timeline-marker type-${event.type}">${icon(timelineIcon(event.type),15)}</span><div><strong>${escapeHtml(event.text)}</strong><span>${escapeHtml(event.actor)} · ${relativeTime(event.at)}</span></div></div>`).join('')||renderEmptyState('clock','История пуста','Новые действия появятся здесь автоматически.')}</div></section>`;
}

function timelineIcon(type) { return ({created:'plus',claim:'user',contact:'phone',status:'tag',payment:'wallet',change:'edit',comment:'message'}[type]||'clock'); }

