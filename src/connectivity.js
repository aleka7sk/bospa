const SPEC_VERSION = 'connectivity.bospa.kz/v1alpha';
const EVENT_TYPES = new Set([
  'reservation.requested',
  'reservation.updated',
  'reservation.confirmed',
  'reservation.cancelled',
  'reservation.deleted',
]);

export function validateConnectivityEvent(event) {
  const errors = [];
  if (!event || typeof event !== 'object') return {ok:false, errors:['EVENT_REQUIRED']};
  if (event.specVersion !== SPEC_VERSION) errors.push('UNSUPPORTED_SPEC_VERSION');
  if (!event.eventId) errors.push('EVENT_ID_REQUIRED');
  if (!EVENT_TYPES.has(event.eventType)) errors.push('EVENT_TYPE_INVALID');
  if (!event.provider) errors.push('PROVIDER_REQUIRED');
  if (!event.source) errors.push('SOURCE_REQUIRED');
  if (!event.occurredAt || Number.isNaN(Date.parse(event.occurredAt))) errors.push('OCCURRED_AT_INVALID');
  const payload = event.payload;
  if (!payload?.externalReservationId) errors.push('EXTERNAL_RESERVATION_ID_REQUIRED');
  if (!payload?.externalPropertyId) errors.push('EXTERNAL_PROPERTY_ID_REQUIRED');
  if (!payload?.checkIn || !payload?.checkOut || payload.checkIn >= payload.checkOut) errors.push('DATE_RANGE_INVALID');
  if (!payload?.guest?.phone) errors.push('FULL_GUEST_PHONE_REQUIRED');
  return {ok: errors.length === 0, errors};
}

export function toApplicationInput(event, apartmentId) {
  const result = validateConnectivityEvent(event);
  if (!result.ok) {
    const error = new Error(`INVALID_CONNECTIVITY_EVENT: ${result.errors.join(', ')}`);
    error.code = 'INVALID_CONNECTIVITY_EVENT';
    error.details = result.errors;
    throw error;
  }
  if (!apartmentId) throw new Error('APARTMENT_MAPPING_REQUIRED');
  const {payload} = event;
  return {
    apartmentId,
    guestName: payload.guest.name || '',
    phone: payload.guest.phone,
    source: event.source,
    checkIn: payload.checkIn,
    checkOut: payload.checkOut,
    checkInTime: payload.checkInTime || '14:00',
    checkOutTime: payload.checkOutTime || '12:00',
    total: payload.amount?.total ? Math.round(payload.amount.total / 100) : 0,
    providerExternalId: payload.externalReservationId,
  };
}

export function mockRequestedEvent(input) {
  const id = input.eventId || `evt_mock_${Date.now()}`;
  return {
    specVersion: SPEC_VERSION,
    eventId: id,
    eventType: 'reservation.requested',
    provider: 'mock-connectivity',
    source: input.source || 'Booking',
    occurredAt: new Date().toISOString(),
    payload: {
      externalReservationId: input.externalReservationId || id,
      externalPropertyId: input.externalPropertyId || input.apartmentId,
      externalUnitId: input.externalUnitId || input.apartmentId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      checkInTime: input.checkInTime || '14:00',
      checkOutTime: input.checkOutTime || '12:00',
      status: 'request',
      guest: {phone: input.phone, name: input.guestName || null},
      amount: input.total ? {currency:'KZT', total:Math.round(Number(input.total) * 100)} : null,
      rawReference: null,
    },
  };
}

export {SPEC_VERSION};
