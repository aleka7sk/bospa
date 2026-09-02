function renderAnalytics() {
  const s = state();
  const realApps = s.applications.filter(a=>!a.isTest);
  const gross = s.payments.filter(p=>p.amount>0&&p.kind==='rent').reduce((sum,p)=>sum+p.amount,0);
  const refunds = Math.abs(s.payments.filter(p=>p.amount<0).reduce((sum,p)=>sum+p.amount,0));
  const guaranteed = realApps.filter(a=>['prepaid','paid','completed'].includes(a.status)).length;
  const conversion = Math.round(guaranteed/Math.max(1,realApps.length)*100);
  const avg = Math.round(realApps.filter(a=>a.total>0).reduce((sum,a)=>sum+a.total,0)/Math.max(1,realApps.filter(a=>a.total>0).length));
  const chartValues = [31,48,42,65,58,73,69,91,78,102,98,124];
  return `${renderPageIntro('Аналитика бизнеса', 'Выручка, воронка, квартиры и работа команды без отдельной бухгалтерской системы.', `<div class="period-control"><button class="active">Месяц</button><button>7 дней</button><button>Сегодня</button></div><button class="button tertiary" data-action="export-csv">${icon('download',17)}Экспорт</button>`)}
    <section class="dashboard-grid metrics-grid">
      ${renderMetric('Чистые поступления',formatMoney(gross-refunds),'+12,4%','green','wallet')}
      ${renderMetric('Гарантированные брони',String(guaranteed),'+8,1%','cyan','calendar')}
      ${renderMetric('Конверсия в гарантию',`${conversion}%`,'+3,2 п.п.','violet','chart')}
      ${renderMetric('Средний чек',formatMoney(avg),'+4,6%','amber','tag')}
    </section>
    <section class="dashboard-grid analytics-main">
      <article class="glass-card chart-card span-2"><div class="section-head"><div><h3>Поступления</h3><p>Подтверждённые арендные платежи за 12 недель</p></div><span class="trend positive">+18,2%</span></div>${renderLineChart(chartValues)}<div class="chart-footer"><span><i class="legend-dot cyan"></i>Поступления</span><strong>${formatMoney(gross)}</strong></div></article>
      <article class="glass-card donut-card"><div class="section-head"><div><h3>Источники</h3><p>Доля заявок</p></div></div>${renderDonut(realApps)}<div class="source-list">${sourceBreakdown(realApps).map(item=>`<div><span><i style="background:${item.color}"></i>${item.name}</span><strong>${item.percent}%</strong></div>`).join('')}</div></article>
      <article class="glass-card"><div class="section-head"><div><h3>Воронка продаж</h3><p>От заявки до оплаты</p></div></div>${renderFullFunnel(realApps)}</article>
      <article class="glass-card span-2"><div class="section-head"><div><h3>Команда</h3><p>Сопровождение и продажи за период</p></div><button class="text-button" data-action="open-team">Настроить</button></div>${renderManagerTable()}</article>
    </section>`;
}

function renderMetric(label,value,delta,tone,metricIcon) { return `<article class="metric-card dashboard-metric"><div class="metric-top"><span class="summary-icon ${tone}">${icon(metricIcon,20)}</span><em class="trend positive">${delta}</em></div><small>${label}</small><strong>${value}</strong><span>к прошлому периоду</span></article>`; }

function renderLineChart(values) {
  const width=760,height=250,pad=18; const min=Math.min(...values),max=Math.max(...values); const points=values.map((v,i)=>`${pad+i*((width-pad*2)/(values.length-1))},${height-pad-(v-min)/(max-min||1)*(height-pad*2)}`).join(' ');
  const area=`${pad},${height-pad} ${points} ${width-pad},${height-pad}`;
  return `<svg class="line-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="График поступлений"><defs><linearGradient id="area-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2ce6c4" stop-opacity=".38"/><stop offset="1" stop-color="#2ce6c4" stop-opacity="0"/></linearGradient></defs>${[.2,.4,.6,.8].map(y=>`<line x1="${pad}" y1="${height*y}" x2="${width-pad}" y2="${height*y}" class="grid-line"/>`).join('')}<polygon points="${area}" fill="url(#area-gradient)"/><polyline points="${points}" fill="none" stroke="#2ce6c4" stroke-width="4" vector-effect="non-scaling-stroke"/><circle cx="${points.split(' ').at(-1).split(',')[0]}" cy="${points.split(' ').at(-1).split(',')[1]}" r="6" fill="#071022" stroke="#2ce6c4" stroke-width="4"/></svg>`;
}

function sourceBreakdown(apps) {
  const colors=['#2ce6c4','#6a62ff','#24aef3','#f7b955','#f06d9c'];
  const counts=new Map(); for(const app of apps){const source=app.source.replace(' · Тест','');counts.set(source,(counts.get(source)||0)+1);} const total=Math.max(1,apps.length);
  return [...counts.entries()].sort((a,b)=>b[1]-a[1]).map(([name,count],i)=>({name,count,percent:Math.round(count/total*100),color:colors[i%colors.length]}));
}

function renderDonut(apps) {
  const breakdown=sourceBreakdown(apps); let offset=0; const circles=breakdown.map(item=>{const dash=item.percent; const c=`<circle cx="60" cy="60" r="45" pathLength="100" stroke="${item.color}" stroke-dasharray="${dash} ${100-dash}" stroke-dashoffset="-${offset}"/>`;offset+=dash;return c;}).join('');
  return `<div class="donut-wrap"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="45" class="donut-track"/>${circles}</svg><div><strong>${apps.length}</strong><span>заявок</span></div></div>`;
}

function renderFullFunnel(apps) {
  const values=[['Всего заявок',apps.length],['Взяты в работу',apps.filter(a=>a.claimUserId).length],['Предоплачено',apps.filter(a=>['prepaid','paid','completed'].includes(a.status)).length],['Оплачено',apps.filter(a=>['paid','completed'].includes(a.status)).length]];
  const max=Math.max(1,values[0][1]); return `<div class="full-funnel">${values.map(([label,value],i)=>`<div><span>${label}<b>${value}</b></span><i style="width:${Math.max(10,value/max*100)}%;--funnel-index:${i}"></i></div>`).join('')}</div>`;
}

function renderManagerTable() {
  return `<div class="data-table"><div class="table-row table-head"><span>Менеджер</span><span>Заявки</span><span>Гарантия</span><span>Поступления</span><span>Конверсия</span></div>${state().users.filter(u=>u.role==='manager').map(user=>{const apps=state().applications.filter(a=>a.claimUserId===user.id&&!a.isTest);const g=apps.filter(a=>['prepaid','paid','completed'].includes(a.status)).length;const paid=apps.reduce((sum,a)=>sum+a.paid,0);return `<div class="table-row"><span class="person-cell"><i class="avatar small">${user.initials}</i><b>${escapeHtml(user.name)}</b></span><span>${apps.length}</span><span>${g}</span><span>${formatMoney(paid)}</span><span><em class="conversion-pill">${Math.round(g/Math.max(1,apps.length)*100)}%</em></span></div>`;}).join('')}</div>`;
}

