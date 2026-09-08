function renderCalendar() {
  const s = state();
  const zoom = Number(s.session.zoom || 4);
  const dayWidth = zoom === 7 ? 44 : zoom === 2 ? 142 : 76;
  const days = dateRange(ui.calendarStart, ui.calendarCount);
  const apartments = calendarApartments();
  const visibleApplications = filteredApplications();
  const quickFilters = [
    ['all', 'Все'],
    ['mine', 'Мои'],
    ['free', 'Свободные'],
    ['new', 'Новые'],
    ['awaiting', 'Ждут предоплату'],
    ['prepaid', 'Предоплачено'],
    ['paid', 'Оплачено'],
  ];
  const actions = `<button class="button tertiary calendar-today" data-action="today">${icon('calendar',17)}Сегодня</button>
    <button class="button tertiary" data-action="open-filters">${icon('filter',17)}Фильтры</button>
    <button class="button primary desktop-create" data-action="new-application">${icon('plus',18)}Новая заявка</button>`;

  return `${renderPageIntro('Календарь', 'Единая картина ранних заявок, гарантированных броней и цен по каждой квартире.', actions)}
    <section class="calendar-control-card glass-card">
      <div class="quick-filter-scroll" aria-label="Быстрые фильтры">
        ${quickFilters.map(([key, label]) => `<button class="quick-filter ${s.session.filters.quick === key ? 'active' : ''}" data-quick-filter="${key}">${escapeHtml(label)}${key === 'new' ? `<b>${s.applications.filter(a => !a.isTest && a.status === 'new').length}</b>` : ''}</button>`).join('')}
      </div>
      <div class="calendar-control-end">
        <label class="test-toggle" title="Показывать тестовые заявки"><input type="checkbox" data-action-change="toggle-tests" ${s.session.showTests ? 'checked' : ''}/><i></i><span>Тесты</span></label>
        <div class="zoom-control" aria-label="Масштаб календаря">
          ${[[7,'7 дней'],[4,'4 дня'],[2,'2 дня']].map(([value,label]) => `<button class="${zoom === value ? 'active' : ''}" data-zoom="${value}" aria-label="${label}">${value}</button>`).join('')}
        </div>
      </div>
    </section>
    <section class="calendar-insights">
      ${renderCalendarInsight('inbox', 'Новые заявки', s.applications.filter(a => !a.isTest && a.status === 'new').length, 'Ожидают обработки', 'cyan')}
      ${renderCalendarInsight('alert', 'Нужна альтернатива', s.applications.filter(a => !a.isTest && a.needsAlternative).length, 'Квартира уже занята', 'amber', 'filter-attention')}
      ${renderCalendarInsight('wallet', 'Ожидают предоплату', s.applications.filter(a => !a.isTest && a.status === 'awaiting_prepayment').length, 'Активные заявки', 'violet')}
      ${renderCalendarInsight('building', 'Квартиры', apartments.length, `из ${s.apartments.filter(a => a.active).length} активных`, 'green')}
    </section>
    <section class="calendar-shell glass-card" style="--day-width:${dayWidth}px;--calendar-days:${days.length}">
      ${apartments.length ? `<div class="calendar-scroll" id="calendar-scroll">
        <div class="calendar-content">
          ${renderCalendarHeader(days)}
          <div class="calendar-body">
            ${apartments.map(apartment => renderCalendarRow(apartment, days, visibleApplications, dayWidth, zoom)).join('')}
          </div>
        </div>
      </div>` : renderEmptyState('calendar', 'Квартиры не найдены', 'Сбросьте фильтры или измените поисковый запрос.')}
      <footer class="calendar-legend">
        <span><i class="legend-swatch soft"></i>Ранняя заявка</span>
        <span><i class="legend-swatch prepaid"></i>Предоплачено</span>
        <span><i class="legend-swatch paid"></i>Оплачено</span>
        <span><i class="legend-swatch technical"></i>Тех. блок</span>
        <small>Нижняя полоска: пустая → предоплата → полная оплата</small>
      </footer>
    </section>`;
}

function renderCalendarInsight(metricIcon, label, value, hint, tone, action = '') {
  return `<button class="calendar-insight glass-card ${action ? 'interactive' : ''}" ${action ? `data-action="${action}"` : 'type="button"'}>
    <span class="summary-icon ${tone}">${icon(metricIcon,19)}</span>
    <span><small>${escapeHtml(label)}</small><strong>${value}</strong><em>${escapeHtml(hint)}</em></span>
    ${action ? icon('chevronRight',17) : ''}
  </button>`;
}

function renderCalendarHeader(days) {
  let previousMonth = '';
  return `<div class="calendar-header calendar-row-structure">
    <div class="calendar-corner apartment-sticky"><span>Квартира</span><small>Адрес · номер</small></div>
    <div class="calendar-track calendar-date-track">
      ${days.map(date => {
        const key = toDateKey(date);
        const month = date.toLocaleDateString('ru-RU', {month:'long'});
        const showMonth = month !== previousMonth || date.getDate() === 1;
        previousMonth = month;
        const weekend = isWeekend(date, state().workspace.weekendDays);
        return `<div class="calendar-date ${weekend ? 'weekend' : ''} ${isToday(date) ? 'today' : ''}" data-date="${key}">
          ${showMonth ? `<span class="month-label">${escapeHtml(month)}</span>` : ''}
          <strong>${date.getDate()}</strong>
          <small>${date.toLocaleDateString('ru-RU', {weekday:'short'}).replace('.', '')}</small>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderCalendarRow(apartment, days, applications, dayWidth, zoom) {
  const startKey = toDateKey(days[0]);
  const endKey = toDateKey(addDays(days.at(-1), 1));
  const rowApplications = applications.filter(application =>
    application.apartmentId === apartment.id &&
    STATUS[application.status]?.active &&
    overlaps(application.checkIn, application.checkOut, startKey, endKey)
  );
  const hardApplications = rowApplications.filter(isHardApplication);
  const softApplications = rowApplications.filter(application => !isHardApplication(application) && !negativeStatuses.has(application.status));
  const freeSoft = softApplications.filter(application => !hardApplications.some(hard => overlaps(application.checkIn, application.checkOut, hard.checkIn, hard.checkOut)));

  return `<div class="calendar-apartment-row calendar-row-structure" data-apartment-id="${apartment.id}">
    <button class="apartment-cell apartment-sticky" data-action="apartment-details" data-apartment-id="${apartment.id}" title="${escapeHtml(apartment.address)}">
      <span class="apartment-code">${escapeHtml(apartment.code)}</span>
      <strong>${escapeHtml(apartment.complex)}</strong>
      <small>кв. ${escapeHtml(apartment.unit)} · ${escapeHtml(apartment.district)}</small>
      ${apartment.catalogEnabled ? `<em title="В каталоге">${icon('image',13)}</em>` : ''}
    </button>
    <div class="calendar-track apartment-day-track">
      <div class="calendar-day-grid">
        ${days.map(date => {
          const key = toDateKey(date);
          const rate = calculateRate(state(), apartment.id, key);
          const special = state().priceOverrides.some(item => item.apartmentId === apartment.id && key >= item.start && key < item.end);
          return `<button class="calendar-day-cell ${isWeekend(date, state().workspace.weekendDays) ? 'weekend' : ''} ${isToday(date) ? 'today' : ''}" data-action="new-at-date" data-apartment-id="${apartment.id}" data-date="${key}" aria-label="Создать заявку на ${formatDate(key)}">
            <span class="calendar-rate ${special ? 'special' : ''}">${zoom === 7 ? Math.round(rate / 1000) + 'k' : new Intl.NumberFormat('ru-RU').format(rate)}</span>
            ${special ? `<i class="special-rate-dot" title="Особая цена"></i>` : ''}
          </button>`;
        }).join('')}
      </div>
      <div class="calendar-booking-layer">
        ${hardApplications.map(application => renderCalendarApplicationBlock(application, startKey, days.length, dayWidth, zoom, {
          lane: 'hard',
          overlapCount: softApplications.filter(soft => overlaps(soft.checkIn, soft.checkOut, application.checkIn, application.checkOut)).length,
        })).join('')}
        ${renderSoftCalendarApplications(freeSoft, startKey, days.length, dayWidth, zoom)}
      </div>
    </div>
  </div>`;
}

function renderSoftCalendarApplications(applications, startKey, dayCount, dayWidth, zoom) {
  const sorted = [...applications].sort((a, b) => {
    const mineA = a.claimUserId === state().session.userId ? 1 : 0;
    const mineB = b.claimUserId === state().session.userId ? 1 : 0;
    if (mineA !== mineB) return mineB - mineA;
    const priority = {awaiting_prepayment:3, thinking:2, no_answer:1, new:0};
    return (priority[b.status] || 0) - (priority[a.status] || 0) || b.updatedAt.localeCompare(a.updatedAt);
  });
  const clusters = [];
  for (const application of sorted) {
    let cluster = clusters.find(item => item.some(other => overlaps(other.checkIn, other.checkOut, application.checkIn, application.checkOut)));
    if (!cluster) { cluster = []; clusters.push(cluster); }
    cluster.push(application);
  }
  return clusters.map(cluster => {
    if (cluster.length === 1) return renderCalendarApplicationBlock(cluster[0], startKey, dayCount, dayWidth, zoom, {lane:'soft-full'});
    const visible = cluster.slice(0, 2);
    const hidden = Math.max(0, cluster.length - 2);
    return visible.map((application, index) => renderCalendarApplicationBlock(application, startKey, dayCount, dayWidth, zoom, {
      lane: index === 0 ? 'soft-top' : 'soft-bottom',
      overflowCount: index === 1 ? hidden : 0,
    })).join('');
  }).join('');
}

function renderCalendarApplicationBlock(application, startKey, dayCount, dayWidth, zoom, options = {}) {
  const start = clamp(dayDiff(startKey, application.checkIn), 0, dayCount);
  const end = clamp(dayDiff(startKey, application.checkOut), 0, dayCount);
  if (end <= start) return '';
  const left = start * dayWidth + 2;
  const width = Math.max(dayWidth - 4, (end - start) * dayWidth - 4);
  const meta = statusMeta(application.status);
  const claim = userById(application.claimUserId);
  const mine = application.claimUserId === state().session.userId;
  const compact = zoom === 7 || width < 92;
  const guest = application.status === 'technical' ? 'Технический блок' : (application.guestName || formatPhone(application.phone));
  const manager = mine ? 'Моя' : claim?.shortName || 'Свободна';
  const classes = ['calendar-booking', `booking-${meta.tone}`, options.lane || 'hard', mine ? 'mine' : '', application.isTest ? 'test' : ''].filter(Boolean).join(' ');
  const progress = application.status === 'paid' ? 100 : application.status === 'prepaid' ? 50 : 0;
  const badgeCount = Number(options.overlapCount || options.overflowCount || 0);

  return `<button class="${classes}" style="left:${left}px;width:${width}px;--payment-progress:${progress}%" data-action="open-application" data-application-id="${application.id}" title="${escapeHtml(guest)} · ${escapeHtml(meta.label)}">
    <span class="booking-content">
      ${application.isTest ? '<i class="test-mini">Тест</i>' : ''}
      <strong>${escapeHtml(compact ? (application.guestName || application.phone.slice(-4)) : guest)}</strong>
      ${!compact ? `<small>${escapeHtml(manager)}${application.source ? ` · ${escapeHtml(application.source.replace(' · Тест',''))}` : ''}</small>` : `<small>${escapeHtml(mine ? 'Моя' : claim?.initials || '')}</small>`}
    </span>
    ${mine ? '<i class="mine-marker" aria-hidden="true"></i>' : ''}
    ${application.needsAlternative ? `<span class="calendar-attention" title="Нужна альтернатива">${icon('alert',12)}</span>` : ''}
    ${badgeCount > 0 ? `<span class="overlap-badge" data-action="open-overlap-list" data-apartment-id="${application.apartmentId}">+${badgeCount}</span>` : ''}
    <span class="payment-stripe"><i></i></span>
  </button>`;
}
