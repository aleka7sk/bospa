import test from 'node:test';
import assert from 'node:assert/strict';

import {seedState} from '../src/data.js';
import {createStore, calculateBilling, calculateStayTotal, hasHardConflict} from '../src/store.js';
import {mockRequestedEvent, validateConnectivityEvent} from '../src/connectivity.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

test('component billing returns a positive configurable total', () => {
  const billing = calculateBilling(seedState);
  assert.ok(billing.activePoints > 0);
  assert.ok(billing.activeManagers > 0);
  assert.ok(billing.total > billing.base);
});

test('rate calendar calculates a stay total', () => {
  const total = calculateStayTotal(seedState, 'apt-1', '2032-01-10', '2032-01-13');
  assert.ok(total > 0);
});

test('a manually created application is claimed by its author', () => {
  const store = createStore({storage: memoryStorage()});
  const state = store.getState();
  const created = store.createApplication({
    apartmentId: state.apartments[0].id,
    guestName: 'Тестовый клиент',
    phone: '+7 700 111 22 33',
    source: 'Ручная',
    status: 'new',
    checkIn: '2032-02-10',
    checkOut: '2032-02-12',
    checkInTime: '14:00',
    checkOutTime: '12:00',
    requiredPrepayment: 10000,
    deposit: 0,
  });

  assert.equal(created.claimUserId, state.session.userId);
  assert.equal(created.status, 'new');
  assert.equal(created.isTest, false);
});

test('hard availability detects an overlapping guaranteed booking', () => {
  const existing = seedState.applications.find(application => application.id === 'app-103');
  assert.ok(existing, 'expected guaranteed fixture app-103');
  const conflict = hasHardConflict(seedState, {...existing, id: 'candidate'}, 'candidate');
  assert.equal(conflict?.id, existing.id);
});

test('mock connectivity event satisfies the v1alpha contract', () => {
  const event = mockRequestedEvent({
    apartmentId: 'apt-1',
    externalPropertyId: 'booking-property-1',
    phone: '+7 700 111 22 33',
    guestName: 'Гость',
    checkIn: '2032-03-10',
    checkOut: '2032-03-12',
    source: 'Booking',
  });
  assert.deepEqual(validateConnectivityEvent(event), {ok: true, errors: []});
});
