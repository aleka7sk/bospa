import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apiDateKey,
  apiTime,
  mapApiApplication,
  mapApiApartment,
  zonedDateTimeToISO,
} from '../src/api.js';

test('Kazakhstan local date/time round-trips through API UTC format', () => {
  const iso = zonedDateTimeToISO('2026-09-10', '14:00', 'Asia/Almaty');
  assert.equal(apiDateKey(iso, 'Asia/Almaty'), '2026-09-10');
  assert.equal(apiTime(iso, 'Asia/Almaty'), '14:00');
});

test('API application maps tiyn, claims and local calendar fields', () => {
  const mapped = mapApiApplication({
    id: 'app-1', workspaceId: 'ws-1', externalId: 'MAN-1', apartmentId: 'apt-1',
    guestName: 'Алия', phone: '+77000000000', source: 'Ручная', status: 'prepaid',
    checkInAt: '2026-09-10T09:00:00Z', checkOutAt: '2026-09-12T07:00:00Z',
    totalAmountTiyn: 7500000, requiredPrepaymentTiyn: 2000000, paidAmountTiyn: 2000000,
    depositAmountTiyn: 1000000, claimedBy: 'user-1', creditedManagerId: 'user-1',
    isTest: false, needsAlternative: false, pinnedNote: '', lockVersion: 4,
    createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z',
  }, 'Asia/Almaty');

  assert.equal(mapped.checkIn, '2026-09-10');
  assert.equal(mapped.checkInTime, '14:00');
  assert.equal(mapped.checkOutTime, '12:00');
  assert.equal(mapped.total, 75000);
  assert.equal(mapped.paid, 20000);
  assert.equal(mapped.claimUserId, 'user-1');
  assert.equal(mapped.lockVersion, 4);
});

test('API apartment maps rates from tiyn and keeps display defaults', () => {
  const mapped = mapApiApartment({
    id: 'apt-1', workspaceId: 'ws-1', code: 'A-1', address: 'Туран 10, кв. 1', unit: '1',
    city: 'Астана', district: 'Нура', complex: 'Turan', rooms: 2, capacity: 4,
    checkInTime: '14:00:00', checkOutTime: '12:00:00', weekdayRateTiyn: 2500000,
    weekendRateTiyn: 3000000, active: true, catalogEnabled: true, published: false,
    lockVersion: 1,
  });

  assert.equal(mapped.weekdayRate, 25000);
  assert.equal(mapped.weekendRate, 30000);
  assert.equal(mapped.checkIn, '14:00');
  assert.equal(mapped.photos.length, 4);
});
