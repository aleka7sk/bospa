function renderCatalog() {
  const s=state(); const q=ui.catalogSearch.toLowerCase(); const apartments=s.apartments.filter(a=>a.active&&a.catalogEnabled&&[a.address,a.code,a.district].join(' ').toLowerCase().includes(q));
  const selectedApp=applicationById(ui.selectedApplicationId); const from=selectedApp?.checkIn||todayKey(); const to=selectedApp?.checkOut||toDateKey(addDays(todayKey(),3));
  return `${renderPageIntro('Каталог квартир', 'Публичные подборки синхронизированы с hard-занятостью Календаря. Бронировать на странице нельзя.', `<button class="button secondary" data-action="preview-catalog">${icon('eye',18)}Публичный вид</button><button class="button primary" data-action="create-catalog-link">${icon('share',18)}Создать подборку</button>`)}
    <section class="catalog-toolbar glass-card"><label>${icon('search',18)}<input data-input="catalog-search" value="${escapeHtml(ui.catalogSearch)}" placeholder="ЖК, район или код квартиры"/></label><div class="catalog-dates"><span>${icon('calendar',17)}${formatPeriod(from,to)}</span><button data-action="catalog-dates">Изменить</button></div><div class="catalog-stats"><span><strong>${apartments.filter(a=>isApartmentAvailable(a.id,from,to)).length}</strong> свободно</span><span><strong>${apartments.length}</strong> опубликовано</span></div></section>
    <section class="catalog-grid">${apartments.map(apartment=>renderCatalogCard(apartment,from,to)).join('')||renderEmptyState('home','Квартиры не найдены','Измените поиск или включите квартиру в модуль каталога.')}</section>`;
}

function isApartmentAvailable(apartmentId,from,to) { return !state().applications.some(a=>a.apartmentId===apartmentId&&isHardApplication(a)&&overlaps(a.checkIn,a.checkOut,from,to)); }

function renderCatalogCard(apartment,from,to) {
  const available=isApartmentAvailable(apartment.id,from,to); const total=calculateStayTotal(state(),apartment.id,from,to); const activeApps=state().applications.filter(a=>a.apartmentId===apartment.id&&STATUS[a.status]?.active&&!a.isTest).length;
  return `<article class="catalog-card glass-card"><div class="catalog-photo"><img src="${apartment.photos?.[0]||apartmentArtwork(apartment)}" alt="${escapeHtml(apartment.complex)}"/><span class="watermark">${escapeHtml(state().settings.watermark)}</span><span class="availability ${available?'available':'unavailable'}">${available?`${icon('check',14)}Свободна`:`${icon('lock',14)}Занята`}</span><span class="photo-count">${icon('image',14)}${apartment.photos?.length||0}/15</span></div><div class="catalog-card-body"><div class="catalog-card-title"><div><span>${escapeHtml(apartment.code)}</span><h3>${escapeHtml(apartment.complex)} · кв. ${escapeHtml(apartment.unit)}</h3></div><button class="icon-button" data-action="edit-apartment" data-apartment-id="${apartment.id}">${icon('dots',20)}</button></div><p>${escapeHtml(apartment.district)} · ${apartment.rooms}-комн. · до ${apartment.capacity} гостей</p><div class="feature-row">${apartment.features.slice(0,3).map(f=>`<span>${escapeHtml(f)}</span>`).join('')}</div><div class="catalog-card-footer"><div><small>${nights(from,to)} ночи</small><strong>${formatMoney(total)}</strong></div><div><small>Активных заявок</small><strong>${activeApps}</strong></div><label class="switch"><input type="checkbox" data-toggle-apartment-published="${apartment.id}" ${apartment.published?'checked':''}/><i></i><span>${apartment.published?'Опубликована':'Скрыта'}</span></label></div></div></article>`;
}

function renderMore() {
  const billing=store.getBilling(); const sections=[
    ['pricing','tag','Цены и календарь ставок','Будни, выходные и особые даты'],
    ['apartments','building','Квартиры','Адреса, время заезда и каталог'],
    ['team','users','Команда и права','Менеджеры, владельцы и доступы'],
    ['subscription','card','Подписка','Квоты, счета и срок доступа'],
    ['import','upload','Импорт данных','Универсальные CSV-шаблоны'],
    ['test','spark','Test Center','Симуляция Booking-событий'],
    ['backup','database','Экспорт и backup','Переносимый архив владельца'],
    ['settings','settings','Настройки бизнеса','Kaspi, уведомления и безопасность'],
  ];
  return `${renderPageIntro('Управление', 'Настройки workspace и инструменты операционной команды.', '')}
  <section class="management-hero glass-card"><div><span class="summary-icon violet">${icon('card',22)}</span><div><small>Текущий период до ${formatDate(state().workspace.subscriptionEndsAt)}</small><strong>${formatMoney(billing.total)} / месяц</strong><p>${billing.activePoints} квартир · ${billing.activeManagers} менеджера · каталог на ${billing.catalogPoints} точках</p></div></div><button class="button primary" data-action="open-subscription">Управлять подпиской</button></section>
  <section class="management-grid">${sections.map(([action,itemIcon,title,subtitle])=>`<button class="management-item glass-card" data-action="open-${action}"><span>${icon(itemIcon,23)}</span><div><strong>${title}</strong><small>${subtitle}</small></div>${icon('chevronRight',19)}</button>`).join('')}</section>
  <section class="glass-card danger-zone"><div><h3>Демо-режим</h3><p>Все изменения сохраняются только в этом браузере. Можно вернуть исходные данные.</p></div><button class="button danger" data-action="reset-demo">Сбросить демо</button></section>`;
}

