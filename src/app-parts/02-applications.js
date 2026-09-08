function renderApplications() {
  const tabs = [['attention','Требуют действия'],['all','Все'],['new','Новые'],['active','Активные'],['closed','Закрытые']];
  let apps = filteredApplications();
  if (ui.applicationListTab === 'attention') apps = apps.filter(a => a.needsAlternative || (!a.claimUserId && a.status === 'new') || (a.status === 'paid' && a.checkOut <= todayKey()));
  if (ui.applicationListTab === 'new') apps = apps.filter(a => a.status === 'new');
  if (ui.applicationListTab === 'active') apps = apps.filter(a => STATUS[a.status]?.active);
  if (ui.applicationListTab === 'closed') apps = apps.filter(a => !STATUS[a.status]?.active);
  apps.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  return `${renderPageIntro('Заявки', 'Прозрачная очередь: вся команда видит клиентов и текущую работу.', `<button class="button primary" data-action="new-application">${icon('plus',18)}Новая заявка</button>`)}
  <section class="list-toolbar glass-card"><div class="segmented-tabs">${tabs.map(([key,label]) => `<button class="${ui.applicationListTab === key ? 'active' : ''}" data-application-list-tab="${key}">${label}${key === 'attention' && attentionApplications().length ? ` <b>${attentionApplications().length}</b>` : ''}</button>`).join('')}</div><button class="button tertiary" data-action="open-filters">${icon('filter',17)}Фильтры</button></section>
  <section class="applications-layout"><div class="application-list">${apps.map(renderApplicationListItem).join('') || renderEmptyState('inbox','Нет заявок','Для выбранного фильтра ничего не найдено.')}</div><aside class="queue-insight glass-card"><h3>Воронка сегодня</h3>${renderMiniFunnel()}<button class="button secondary full" data-route="analytics">Открыть аналитику</button></aside></section>`;
}

function renderApplicationListItem(application) {
  const apartment = apartmentById(application.apartmentId);
  const claim = userById(application.claimUserId);
  const mine = application.claimUserId === state().session.userId;
  return `<article class="application-list-item ${application.needsAlternative ? 'attention' : ''} ${mine ? 'mine' : ''}" data-action="open-application" data-application-id="${application.id}" tabindex="0">
    <div class="application-status-rail status-${statusMeta(application.status).tone}"></div>
    <div class="application-main"><div class="application-title"><div><strong>${escapeHtml(application.guestName || 'Имя не указано')}</strong><span>${formatPhone(application.phone)}</span></div><div>${statusBadge(application,true)}${application.needsAlternative ? '<span class="attention-badge">Нужна альтернатива</span>' : ''}</div></div>
      <div class="application-meta"><span>${icon('building',15)}${escapeHtml(apartment?.address || '—')}</span><span>${icon('calendar',15)}${formatPeriod(application.checkIn,application.checkOut)} · ${nights(application.checkIn,application.checkOut)} ноч.</span><span>${sourceBadge(application.source)}</span></div>
      ${application.pinnedNote ? `<div class="inline-note">${icon('pin',14)}${escapeHtml(application.pinnedNote)}</div>` : ''}
    </div>
    <div class="application-owner"><span class="avatar small">${claim ? escapeHtml(claim.initials) : '—'}</span><small>${claim ? escapeHtml(claim.shortName) : 'Свободна'}</small>${mine ? '<em>Моя</em>' : ''}</div>
    <div class="application-money"><strong>${formatMoney(application.total)}</strong><span>получено ${formatMoney(application.paid)}</span><div class="progress"><i style="width:${Math.min(100,(application.paid/Math.max(1,application.total))*100)}%"></i></div></div>
    <div class="application-time"><small>${relativeTime(application.updatedAt)}</small>${icon('chevronRight',18)}</div>
  </article>`;
}

function renderMiniFunnel() {
  const apps = state().applications.filter(a => !a.isTest);
  const data = [
    ['Новые', apps.filter(a => a.status === 'new').length, 100],
    ['В работе', apps.filter(a => a.claimUserId && softStatuses.has(a.status)).length, 78],
    ['Предоплата', apps.filter(a => a.status === 'prepaid').length, 52],
    ['Оплачено', apps.filter(a => a.status === 'paid' || a.status === 'completed').length, 36],
  ];
  return `<div class="mini-funnel">${data.map(([label,count,width]) => `<div><span>${label}<b>${count}</b></span><i style="width:${width}%"></i></div>`).join('')}</div>`;
}

function renderMyApplications() {
  const apps = filteredApplications({mine:true}).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  const paid = apps.reduce((sum,a) => sum + a.paid, 0);
  const guaranteed = apps.filter(a => ['prepaid','paid','completed'].includes(a.status)).length;
  const conversion = Math.round(guaranteed / Math.max(1,apps.length) * 100);
  return `${renderPageIntro('Мои заявки', 'Личная рабочая очередь и показатели без скрытых данных коллег.', `<button class="button primary" data-action="new-application">${icon('plus',18)}Создать</button>`)}
    <section class="personal-kpis"><div class="metric-card accent-cyan"><small>В работе</small><strong>${apps.filter(a => STATUS[a.status]?.active).length}</strong><span>активных заявок</span></div><div class="metric-card accent-violet"><small>Конверсия</small><strong>${conversion}%</strong><span>в гарантию</span></div><div class="metric-card accent-green"><small>Поступления</small><strong>${formatMoney(paid,true)}</strong><span>по моим клиентам</span></div><div class="metric-card accent-amber"><small>Нужна альтернатива</small><strong>${apps.filter(a => a.needsAlternative).length}</strong><span>клиентов</span></div></section>
    <section class="glass-card my-list-card"><div class="section-head"><div><h3>Моя очередь</h3><p>Сначала показываются заявки, где требуется следующее действие.</p></div><button class="button tertiary" data-action="open-filters">${icon('filter',17)}Период</button></div><div class="application-list compact-list">${apps.map(renderApplicationListItem).join('') || renderEmptyState('user','Заявок пока нет','Возьмите входящую заявку или создайте ручную.')}</div></section>`;
}
