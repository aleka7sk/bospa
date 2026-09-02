function handleSubmit(event) {
  const form=event.target.closest('form[data-form]');if(!form)return;event.preventDefault();const data=Object.fromEntries(new FormData(form).entries());const type=form.dataset.form;
  try{
    if(type==='new-application'){
      if(data.checkOut<=data.checkIn)throw new Error('DATE');
      const created=store.createApplication(data,{isTest:Boolean(data.isTest)});closeOverlay();ui.selectedApplicationId=created.id;render();showToast(data.isTest?'Тестовая заявка создана':'Заявка создана и взята в работу');openOverlay('full-application',{applicationId:created.id});
    } else if(type==='test-application'){
      const event=mockRequestedEvent(data);
      const input=toApplicationInput(event,data.apartmentId);
      input.requiredPrepayment=Number(data.requiredPrepayment||0);
      const created=store.createApplication(input,{isTest:true,external:true,externalId:event.payload.externalReservationId});store.setShowTests(true);closeOverlay();render();showToast('Тестовое Booking-событие создано по v1alpha-контракту');openOverlay('quick-application',{applicationId:created.id});
    } else if(type==='filters'){
      store.setFilters(data);closeOverlay();render();
    } else if(type==='contact'){
      store.addContactOutcome(form.dataset.applicationId,data.outcome,data.note,data.callbackAt||null);closeOverlay();render();showToast('Результат контакта сохранён');openOverlay('full-application',{applicationId:form.dataset.applicationId});
    } else if(type==='payment'){
      store.addPayment(form.dataset.applicationId,data);const app=applicationById(form.dataset.applicationId);closeOverlay();render();showToast('Платёж подтверждён');if(app.status==='awaiting_prepayment'&&app.paid>=app.requiredPrepayment)showToast('Можно перевести заявку в «Предоплачено»');openOverlay('full-application',{applicationId:form.dataset.applicationId});
    } else if(type==='note'){
      store.setPinnedNote(form.dataset.applicationId,data.note||'');closeOverlay();render();showToast('Важная заметка сохранена');openOverlay('full-application',{applicationId:form.dataset.applicationId});
    } else if(type==='comment'){
      store.addComment(form.dataset.applicationId,data.text);form.reset();renderPortal();
    } else if(type==='complete'){
      store.setStatus(form.dataset.applicationId,'completed');closeOverlay();render();showToast('Бронь завершена');
    } else if(type==='catalog-link'){
      const selected=new FormData(form).getAll('apartments');if(!selected.length)throw new Error('EMPTY');const link=store.createCatalogLink(form.dataset.applicationId,selected);openOverlay('catalog-result',{linkId:link.id});render();
    } else if(type==='price'){
      if(data.end<=data.start)throw new Error('DATE');store.setPriceOverride(data);closeOverlay();render();showToast('Особая цена добавлена');
    } else if(type==='add-user'){
      store.addUser(data);form.reset();renderPortal();showToast('Пользователь добавлен');
    } else if(type==='import'){
      showToast('Dry-run завершён: структура файлов принята');closeOverlay();
    } else if(type==='price-book'){
      Object.assign(state().billing,Object.fromEntries(Object.entries(data).filter(([key])=>key in state().billing).map(([key,value])=>[key,Number(value)])));store.replace(state());closeOverlay();render();showToast('Новая версия price book создана');
    }
  }catch(error){const message=error.message==='HARD_CONFLICT'?'Квартира уже занята гарантированной бронью':error.message==='DATE'?'Проверьте период: выезд должен быть позже заезда':'Не удалось выполнить действие';showToast(message,'error');}
}

function handleNextAction(id,next) {
  if(next==='claim'){try{store.claimApplication(id);showToast('Заявка взята в работу');openOverlay('full-application',{applicationId:id});}catch{showToast('Другой менеджер уже взял заявку','error');render();}return;}
  if(next==='contact'){openOverlay('contact',{applicationId:id});return;}
  if(next==='alternative'){openOverlay('catalog-link',{applicationId:id});return;}
  if(next==='send-payment'){sendPaymentMessage(id);return;}
  if(next==='add-payment'){openOverlay('payment',{applicationId:id});return;}
  if(next==='set-prepaid'){changeStatus(id,'prepaid');return;}
  if(next==='set-paid'){changeStatus(id,'paid');return;}
  if(next==='complete'){openOverlay('complete',{applicationId:id});return;}
  if(next==='details'){showToast('Бронь оплачена и ожидает даты выезда');return;}
  openOverlay('status',{applicationId:id});
}

function handleContactAction(id,kind) {
  const application=applicationById(id);if(!application)return;
  if(!application.claimUserId){if(confirm('Взять заявку в работу и продолжить контакт?')){try{store.claimApplication(id);}catch{showToast('Заявку уже взял другой менеджер','error');return;}}else return;}
  if(application.claimUserId!==state().session.userId&&currentUser().role!=='owner'&&!confirm(`Заявка уже в работе у ${userById(application.claimUserId)?.shortName}. Контакт может дублировать общение. Продолжить?`))return;
  if(kind==='call'){store.addContactOutcome(id,'reached','Инициирован звонок из карточки');location.href=`tel:${application.phone.replace(/\s/g,'')}`;}
  else {store.addContactOutcome(id,'reached','Открыт WhatsApp из карточки');const digits=application.phone.replace(/\D/g,'');window.open(`https://wa.me/${digits}`,'_blank','noopener');}
  render();
}

function changeStatus(id,status) {
  try{const application=store.setStatus(id,status);closeOverlay();render();showToast(`Статус: ${STATUS[status].label}`);openOverlay('full-application',{applicationId:application.id});}
  catch(error){if(error.message==='HARD_CONFLICT'){const conflict=error.conflict;showToast(`Конфликт с бронью ${conflict.guestName||conflict.phone}`,'error',4200);}else showToast('Не удалось изменить статус','error');}
}

function sendPaymentMessage(id) {
  const application=applicationById(id);const amount=Math.max(0,(application.status==='awaiting_prepayment'?application.requiredPrepayment:application.total)-application.paid);const text=`Здравствуйте${application.guestName?`, ${application.guestName}`:''}! Для подтверждения брони внесите ${formatMoney(amount)} через Kaspi: ${state().workspace.kaspiLink}. После оплаты отправьте чек в этот чат.`;shareText(text);store.addContactOutcome(id,'reached','Подготовлено сообщение с Kaspi-ссылкой');showToast('Сообщение об оплате подготовлено');
}

async function shareText(text) { try{if(navigator.share)await navigator.share({title:'bospa',text});else{await navigator.clipboard.writeText(text);showToast('Сообщение скопировано');}}catch(error){if(error.name!=='AbortError')showToast('Не удалось открыть меню отправки','error');} }

function downloadApartmentsTemplate(){const content='external_key,address,unit,city,district,complex,check_in,check_out,weekday_rate,weekend_rate,active,public_code,note\nAPT-001,"Нестеров 1",7,Астана,Есиль,"Нестеров",14:00,12:00,26000,32000,true,BAISANAT,""';downloadText('bospa-apartments-template.csv','\uFEFF'+content,'text/csv;charset=utf-8');showToast('Шаблон квартит скачан');}
function downloadBookingsTemplate(){const content='external_key,apartment_external_key,check_in,check_out,phone,guest_name,status,source,total,required_prepayment,paid,deposit,manager,note\nBOOK-001,APT-001,2026-09-10,2026-09-13,+77000000000,Алия,new,manual,78000,20000,0,20000,,""';downloadText('bospa-bookings-template.csv','\uFEFF'+content,'text/csv;charset=utf-8');showToast('Шаблон броней скачан');}

function registerPwa() {
  if('serviceWorker' in navigator && location.protocol!=='file:') navigator.serviceWorker.register('/sw.js').catch(()=>{});
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();ui.installPrompt=event;});
}

store.subscribe((_state,reason)=>{if(!['route','zoom','filters','user'].includes(reason))render();});
window.addEventListener('hashchange',()=>render());
document.addEventListener('click',event=>{if(event.target.matches('.overlay-backdrop')||event.target.closest('[data-action],[data-route],[data-zoom],[data-quick-filter],[data-application-list-tab],[data-application-tab],[data-switch-user],[data-copy],[data-share-text]'))handleClick(event);});
document.addEventListener('change',handleChange);
document.addEventListener('input',handleInput);
document.addEventListener('submit',handleSubmit);
document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(ui.overlay)closeOverlay();else if(ui.notificationsOpen||ui.userMenuOpen){ui.notificationsOpen=false;ui.userMenuOpen=false;renderPortal();}}});
document.addEventListener('click',event=>{if(ui.notificationsOpen&&!event.target.closest('.notification-popover')&&!event.target.closest('[data-action="toggle-notifications"]')){ui.notificationsOpen=false;renderPortal();}if(ui.userMenuOpen&&!event.target.closest('.user-popover')&&!event.target.closest('[data-action="toggle-user-menu"]')){ui.userMenuOpen=false;renderPortal();}});

registerPwa();
render();
