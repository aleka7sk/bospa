import {addDays, apartmentArtwork, toDateKey} from './utils.js';

const today = toDateKey(new Date());
const d = offset => toDateKey(addDays(today, offset));
const now = Date.now();
const minutesAgo = amount => new Date(now - amount * 60_000).toISOString();

const apartments = [
  ['apt-1', 'BAISANAT', 'Нестеров 1', '7', 'Есиль', 26000, 32000, 2, 4],
  ['apt-2', 'NOMAD', 'Брянская 12', '45', 'Сарыарка', 21000, 26000, 1, 2],
  ['apt-3', 'ORDA', 'Нестеров 1', '28', 'Есиль', 30000, 36000, 2, 5],
  ['apt-4', 'TURAN', 'Туран 55/2', '91', 'Нура', 34000, 42000, 3, 6],
  ['apt-5', 'EXPO', 'Ұлы Дала 35', '107', 'Есиль', 28000, 34000, 2, 4],
  ['apt-6', 'CAPITAL', 'Сығанақ 16/5', '208', 'Нура', 39000, 47000, 3, 6],
  ['apt-7', 'BOTANIC', 'Кабанбай 58Б', '33', 'Есиль', 31000, 38000, 2, 4],
  ['apt-8', 'ARUNA', 'Мәңгілік Ел 51', '16', 'Есиль', 23000, 29000, 1, 3],
  ['apt-9', 'PROMENADE', 'Түркістан 10', '62', 'Нура', 36000, 44000, 3, 6],
  ['apt-10', 'SEVER', 'Богенбай 40', '12', 'Сарыарка', 19000, 24000, 1, 2],
  ['apt-11', 'PRESIDENTIAL', 'Достық 12', '72', 'Есиль', 45000, 56000, 3, 6],
  ['apt-12', 'GREENLINE', 'Ханов Керея 22', '84', 'Нура', 33000, 41000, 2, 5],
].map(([id, code, complex, unit, district, weekdayRate, weekendRate, rooms, capacity], index) => {
  const apartment = {
    id, code, complex, unit, district,
    address: `${complex}, кв. ${unit}`,
    city: 'Астана', rooms, capacity,
    weekdayRate, weekendRate,
    checkIn: '14:00', checkOut: '12:00',
    active: true, catalogEnabled: index !== 9,
    published: index < 9,
    features: index % 3 === 0 ? ['Wi‑Fi', 'Парковка', 'Smart TV', 'Кондиционер'] : ['Wi‑Fi', 'Smart TV', 'Кухня'],
    description: 'Светлая квартира для комфортного проживания в центре Астаны. Быстрый заезд, чистое бельё и всё необходимое для гостей.',
  };
  apartment.photos = Array.from({length: 4}, (_, photoIndex) => apartmentArtwork(apartment, photoIndex));
  return apartment;
});

const timeline = (...events) => events.map((event, index) => ({id: `tl-${Math.random().toString(36).slice(2)}-${index}`, ...event}));

export const seedState = {
  version: 3,
  session: {
    userId: 'user-owner', role: 'owner', route: 'calendar', zoom: 4, showTests: false,
    filters: {quick: 'all', status: '', source: '', manager: '', from: '', to: ''},
  },
  workspace: {
    id: 'ws-bospa-demo', name: 'Arman Apartments', city: 'Астана', timezone: 'Asia/Almaty', weekendDays: [5, 6],
    trialEndsAt: d(4), subscriptionEndsAt: d(24), subscriptionStatus: 'active', catalogEnabled: true,
    kaspiLink: 'https://pay.kaspi.kz/pay/demo-bospa', supportPhone: '+7 777 700 11 22',
  },
  users: [
    {id: 'user-owner', name: 'Алишер Толегенов', shortName: 'Алишер', role: 'owner', active: true, initials: 'АТ'},
    {id: 'user-aigerim', name: 'Айгерим Т.', shortName: 'Айгерим', role: 'manager', active: true, initials: 'АТ'},
    {id: 'user-daniyar', name: 'Данияр С.', shortName: 'Данияр', role: 'manager', active: true, initials: 'ДС'},
    {id: 'user-aliya', name: 'Алия К.', shortName: 'Алия', role: 'manager', active: true, initials: 'АК'},
    {id: 'user-super', name: 'Bospa Platform', shortName: 'Superadmin', role: 'superadmin', active: true, initials: 'BP'},
  ],
  apartments,
  applications: [
    {
      id: 'app-101', externalId: 'BK-582104', apartmentId: 'apt-1', guestName: 'София', phone: '+7 914 111 21 12', source: 'Booking', status: 'new',
      checkIn: d(0), checkOut: d(3), checkInTime: '14:00', checkOutTime: '12:00', total: 84000, requiredPrepayment: 25000, paid: 0, deposit: 20000,
      claimUserId: null, creditedManagerId: null, isTest: false, needsAlternative: false, pinnedNote: '', createdAt: minutesAgo(8), updatedAt: minutesAgo(8), comments: [],
      timeline: timeline({type:'created', text:'Новая заявка получена из Booking', actor:'Система', at:minutesAgo(8)}),
    },
    {
      id: 'app-102', externalId: 'BK-582083', apartmentId: 'apt-1', guestName: 'Наталья', phone: '+7 914 554 78 10', source: 'Booking', status: 'awaiting_prepayment',
      checkIn: d(1), checkOut: d(5), checkInTime: '14:00', checkOutTime: '12:00', total: 116000, requiredPrepayment: 30000, paid: 0, deposit: 20000,
      claimUserId: 'user-aigerim', creditedManagerId: null, isTest: false, needsAlternative: false, pinnedNote: 'Написать после 18:30 — на работе.', createdAt: minutesAgo(74), updatedAt: minutesAgo(12),
      comments: [{id:'c-102', text:'Клиент подтвердил даты, ждёт реквизиты.', authorId:'user-aigerim', at:minutesAgo(20)}],
      timeline: timeline(
        {type:'created', text:'Заявка получена из Booking', actor:'Система', at:minutesAgo(74)},
        {type:'claim', text:'Айгерим взяла заявку в работу', actor:'Айгерим', at:minutesAgo(69)},
        {type:'contact', text:'Дозвонилась: клиент подтвердил даты', actor:'Айгерим', at:minutesAgo(20)},
      ),
    },
    {
      id: 'app-103', externalId: 'MAN-103', apartmentId: 'apt-2', guestName: 'Сергей И.', phone: '+7 707 220 18 99', source: 'Ручная', status: 'prepaid',
      checkIn: d(-1), checkOut: d(2), checkInTime: '15:00', checkOutTime: '12:00', total: 68000, requiredPrepayment: 25000, paid: 25000, deposit: 15000,
      claimUserId: 'user-daniyar', creditedManagerId: 'user-daniyar', isTest: false, needsAlternative: false, pinnedNote: 'Заедет с ребёнком. Нужна детская кроватка.', createdAt: minutesAgo(430), updatedAt: minutesAgo(180), comments: [],
      timeline: timeline(
        {type:'created', text:'Ручная заявка создана Данияром', actor:'Данияр', at:minutesAgo(430)},
        {type:'payment', text:'Подтверждена предоплата 25 000 ₸ · Kaspi', actor:'Данияр', at:minutesAgo(180)},
        {type:'status', text:'Статус изменён на «Предоплачено»', actor:'Данияр', at:minutesAgo(179)},
      ),
    },
    {
      id:'app-104', externalId:'MAN-104', apartmentId:'apt-3', guestName:'Айдана', phone:'+7 701 449 62 10', source:'Instagram', status:'paid',
      checkIn:d(2), checkOut:d(6), checkInTime:'14:00', checkOutTime:'12:00', total:132000, requiredPrepayment:40000, paid:132000, deposit:20000,
      claimUserId:'user-aigerim', creditedManagerId:'user-aigerim', isTest:false, needsAlternative:false, pinnedNote:'', createdAt:minutesAgo(1200), updatedAt:minutesAgo(72), comments:[],
      timeline: timeline({type:'created', text:'Заявка создана вручную', actor:'Айгерим', at:minutesAgo(1200)}, {type:'payment', text:'Оплата подтверждена полностью', actor:'Айгерим', at:minutesAgo(72)}),
    },
    {
      id:'app-105', externalId:'BK-582015', apartmentId:'apt-4', guestName:'Ермек', phone:'+7 705 313 20 09', source:'Booking', status:'thinking',
      checkIn:d(4), checkOut:d(8), checkInTime:'14:00', checkOutTime:'12:00', total:156000, requiredPrepayment:30000, paid:0, deposit:30000,
      claimUserId:'user-aliya', creditedManagerId:null, isTest:false, needsAlternative:false, pinnedNote:'', createdAt:minutesAgo(95), updatedAt:minutesAgo(48), comments:[],
      timeline: timeline({type:'contact', text:'Клиент думает до вечера', actor:'Алия', at:minutesAgo(48)}),
    },
    {
      id:'app-106', externalId:'KR-24019', apartmentId:'apt-4', guestName:'Диана', phone:'+7 778 815 44 20', source:'Krisha', status:'new',
      checkIn:d(4), checkOut:d(7), checkInTime:'14:00', checkOutTime:'12:00', total:118000, requiredPrepayment:25000, paid:0, deposit:30000,
      claimUserId:null, creditedManagerId:null, isTest:false, needsAlternative:false, pinnedNote:'', createdAt:minutesAgo(21), updatedAt:minutesAgo(21), comments:[],
      timeline: timeline({type:'created', text:'Новая заявка из Krisha', actor:'Система', at:minutesAgo(21)}),
    },
    {
      id:'app-107', externalId:'MAN-107', apartmentId:'apt-5', guestName:'Олег', phone:'+7 747 220 05 90', source:'Ручная', status:'paid',
      checkIn:d(-5), checkOut:d(-1), checkInTime:'14:00', checkOutTime:'12:00', total:112000, requiredPrepayment:30000, paid:112000, deposit:20000,
      claimUserId:'user-daniyar', creditedManagerId:'user-daniyar', isTest:false, needsAlternative:false, pinnedNote:'Выехал, квартира проверена.', createdAt:minutesAgo(8900), updatedAt:minutesAgo(250), comments:[], timeline:[],
    },
    {
      id:'app-108', externalId:'BK-581992', apartmentId:'apt-6', guestName:'Марина', phone:'+7 777 890 47 27', source:'Booking', status:'no_answer',
      checkIn:d(7), checkOut:d(10), checkInTime:'14:00', checkOutTime:'12:00', total:128000, requiredPrepayment:35000, paid:0, deposit:25000,
      claimUserId:'user-aigerim', creditedManagerId:null, isTest:false, needsAlternative:false, pinnedNote:'', createdAt:minutesAgo(142), updatedAt:minutesAgo(104), comments:[],
      timeline: timeline({type:'contact', text:'Не ответила на звонок', actor:'Айгерим', at:minutesAgo(104)}),
    },
    {
      id:'app-109', externalId:'SIM-109', apartmentId:'apt-7', guestName:'Тестовый гость', phone:'+7 700 000 00 09', source:'Booking · Тест', status:'new',
      checkIn:d(1), checkOut:d(4), checkInTime:'14:00', checkOutTime:'12:00', total:96000, requiredPrepayment:30000, paid:0, deposit:0,
      claimUserId:null, creditedManagerId:null, isTest:true, needsAlternative:false, pinnedNote:'', createdAt:minutesAgo(6), updatedAt:minutesAgo(6), comments:[],
      timeline: timeline({type:'created', text:'Тестовая заявка создана в симуляторе', actor:'Система', at:minutesAgo(6)}),
    },
    {
      id:'app-110', externalId:'MAN-110', apartmentId:'apt-8', guestName:'Рустам', phone:'+7 702 145 93 82', source:'WhatsApp', status:'awaiting_prepayment',
      checkIn:d(0), checkOut:d(2), checkInTime:'14:00', checkOutTime:'12:00', total:50000, requiredPrepayment:15000, paid:0, deposit:10000,
      claimUserId:'user-owner', creditedManagerId:null, isTest:false, needsAlternative:false, pinnedNote:'', createdAt:minutesAgo(58), updatedAt:minutesAgo(30), comments:[], timeline:[],
    },
    {
      id:'app-111', externalId:'MAN-111', apartmentId:'apt-9', guestName:'Людмила', phone:'+7 701 201 01 98', source:'Ручная', status:'technical',
      checkIn:d(3), checkOut:d(5), checkInTime:'12:00', checkOutTime:'18:00', total:0, requiredPrepayment:0, paid:0, deposit:0,
      claimUserId:'user-owner', creditedManagerId:null, isTest:false, needsAlternative:false, pinnedNote:'Плановое обслуживание кондиционера.', createdAt:minutesAgo(400), updatedAt:minutesAgo(400), comments:[], timeline:[],
    },
  ],
  payments: [
    {id:'pay-1', applicationId:'app-103', amount:25000, kind:'rent', method:'Kaspi', status:'confirmed', createdAt:minutesAgo(180), createdBy:'user-daniyar'},
    {id:'pay-2', applicationId:'app-104', amount:40000, kind:'rent', method:'Kaspi', status:'confirmed', createdAt:minutesAgo(820), createdBy:'user-aigerim'},
    {id:'pay-3', applicationId:'app-104', amount:92000, kind:'rent', method:'Банковский перевод', status:'confirmed', createdAt:minutesAgo(72), createdBy:'user-aigerim'},
    {id:'pay-4', applicationId:'app-107', amount:112000, kind:'rent', method:'Kaspi', status:'confirmed', createdAt:minutesAgo(7000), createdBy:'user-daniyar'},
  ],
  notifications: [
    {id:'n-1', title:'Новая заявка из Booking', body:'София · Нестеров 1, кв. 7', read:false, at:minutesAgo(8), applicationId:'app-101'},
    {id:'n-2', title:'Новая заявка из Krisha', body:'Диана · Туран 55/2, кв. 91', read:false, at:minutesAgo(21), applicationId:'app-106'},
    {id:'n-3', title:'Оплата подтверждена', body:'Айдана · 92 000 ₸ · оплачено полностью', read:true, at:minutesAgo(72), applicationId:'app-104'},
  ],
  catalogLinks: [],
  priceOverrides: [
    {id:'rate-1', apartmentId:'apt-3', start:d(5), end:d(7), price:45000, reason:'Концерт'},
    {id:'rate-2', apartmentId:'apt-4', start:d(8), end:d(11), price:52000, reason:'Матч сборной'},
  ],
  billing: {
    trialDays:7, anchorDay:15, pointUnitPrice:1200, managerUnitPrice:500, extraOwnerPrice:2000, catalogPointPrice:350, baseFee:3000,
    invoices:[
      {id:'inv-2026-08', period:'15 авг — 15 сен', amount:23850, status:'paid', paidAt:d(-18), receipt:'kaspi-aug.pdf'},
      {id:'inv-2026-09', period:'15 сен — 15 окт', amount:23850, status:'upcoming', dueAt:d(13)},
    ],
  },
  settings: {testModeEnabled:true, notificationsEnabled:true, catalogDefaultExpiryHours:24, watermark:'Arman Apartments', priceVisibility:'exact', mapProvider:'2GIS'},
};
