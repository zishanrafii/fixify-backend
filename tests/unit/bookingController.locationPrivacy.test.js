// REGRESSION: a provider must not see a customer's exact service address
// before they've committed to a PENDING booking (they might still reject
// it). Once ACCEPTED or later, they've committed (or the booking already
// concluded) and legitimately need it. The customer always sees their own
// booking in full regardless of status. See bookingController.js
// getMyBookings()/getBookingById() for the implementation.

jest.mock('../../src/config/db', () => ({
  booking: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
}));

jest.mock('../../src/notifications/notificationEngine', () => ({ notify: jest.fn() }));
jest.mock('../../src/services/walletService', () => ({
  releaseEscrowForBooking: jest.fn(),
  refundEscrowForBooking: jest.fn(),
}));
jest.mock('../../src/services/recurrenceService', () => ({ getNextOccurrence: jest.fn() }));

const prisma = require('../../src/config/db');
const { getMyBookings, getBookingById } = require('../../src/controllers/bookingController');

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function makeBooking(overrides = {}) {
  return {
    id: 'booking-1',
    customerId: 'customer-1',
    providerId: 'provider-profile-1',
    listingId: 'listing-1',
    status: 'PENDING',
    serviceAddress: '123 Secret St, Dhaka',
    latitude: 23.777,
    longitude: 90.399,
    scheduledTime: new Date().toISOString(),
    provider: { id: 'provider-profile-1', userId: 'provider-user-1', user: { id: 'provider-user-1', name: 'Provider' } },
    customer: { id: 'customer-1', name: 'Customer' },
    listing: { id: 'listing-1', title: 'Test Listing' },
    ...overrides,
  };
}

describe('REGRESSION: getMyBookings() location privacy', () => {
  beforeEach(() => jest.clearAllMocks());

  test('1. Customer + PENDING -> full location visible', async () => {
    const booking = makeBooking({ status: 'PENDING' });
    prisma.booking.findMany.mockResolvedValue([booking]);
    prisma.booking.count.mockResolvedValue(1);

    const req = { query: {}, user: { id: 'customer-1' } }; // requester IS the customer
    const res = makeRes();
    await getMyBookings(req, res);

    const [[jsonArg]] = res.json.mock.calls;
    const returned = jsonArg.data.bookings[0];
    expect(returned.serviceAddress).toBe('123 Secret St, Dhaka');
    expect(returned.latitude).toBe(23.777);
    expect(returned.longitude).toBe(90.399);
  });

  test('2. Provider + PENDING -> exact location omitted', async () => {
    const booking = makeBooking({ status: 'PENDING' });
    prisma.booking.findMany.mockResolvedValue([booking]);
    prisma.booking.count.mockResolvedValue(1);

    const req = { query: {}, user: { id: 'provider-user-1' } }; // requester IS the provider
    const res = makeRes();
    await getMyBookings(req, res);

    const [[jsonArg]] = res.json.mock.calls;
    const returned = jsonArg.data.bookings[0];
    expect(returned.serviceAddress).toBeUndefined();
    expect(returned.latitude).toBeUndefined();
    expect(returned.longitude).toBeUndefined();
    // Everything else must still be present - this is a field omission,
    // not a stripped-down/different object shape.
    expect(returned.id).toBe('booking-1');
    expect(returned.status).toBe('PENDING');
    expect(returned.listing).toEqual({ id: 'listing-1', title: 'Test Listing' });
  });

  test('3. Provider + ACCEPTED -> full location visible', async () => {
    const booking = makeBooking({ status: 'ACCEPTED' });
    prisma.booking.findMany.mockResolvedValue([booking]);
    prisma.booking.count.mockResolvedValue(1);

    const req = { query: {}, user: { id: 'provider-user-1' } };
    const res = makeRes();
    await getMyBookings(req, res);

    const [[jsonArg]] = res.json.mock.calls;
    const returned = jsonArg.data.bookings[0];
    expect(returned.serviceAddress).toBe('123 Secret St, Dhaka');
    expect(returned.latitude).toBe(23.777);
    expect(returned.longitude).toBe(90.399);
  });

  test('4. Provider + later statuses (IN_PROGRESS, COMPLETED, REJECTED, CANCELLED_BY_CUSTOMER, EXPIRED, DISPUTED) -> full location visible', async () => {
    const laterStatuses = ['IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_PROVIDER', 'EXPIRED', 'DISPUTED'];

    for (const status of laterStatuses) {
      const booking = makeBooking({ status });
      prisma.booking.findMany.mockResolvedValue([booking]);
      prisma.booking.count.mockResolvedValue(1);

      const req = { query: {}, user: { id: 'provider-user-1' } };
      const res = makeRes();
      await getMyBookings(req, res);

      const [[jsonArg]] = res.json.mock.calls;
      const returned = jsonArg.data.bookings[0];
      expect(returned.serviceAddress).toBe('123 Secret St, Dhaka');
      expect(returned.latitude).toBe(23.777);
    }
  });

  test('mixed list: only the PENDING row belonging to the provider is sanitized, others in the same response are untouched', async () => {
    const pendingRow = makeBooking({ id: 'b-pending', status: 'PENDING' });
    const acceptedRow = makeBooking({ id: 'b-accepted', status: 'ACCEPTED' });
    prisma.booking.findMany.mockResolvedValue([pendingRow, acceptedRow]);
    prisma.booking.count.mockResolvedValue(2);

    const req = { query: {}, user: { id: 'provider-user-1' } };
    const res = makeRes();
    await getMyBookings(req, res);

    const [[jsonArg]] = res.json.mock.calls;
    const [returnedPending, returnedAccepted] = jsonArg.data.bookings;
    expect(returnedPending.serviceAddress).toBeUndefined();
    expect(returnedAccepted.serviceAddress).toBe('123 Secret St, Dhaka');
  });
});

describe('REGRESSION: getBookingById() location privacy', () => {
  beforeEach(() => jest.clearAllMocks());

  test('1. Customer + PENDING -> full location visible', async () => {
    prisma.booking.findUnique.mockResolvedValue(makeBooking({ status: 'PENDING' }));
    const req = { params: { id: 'booking-1' }, user: { id: 'customer-1' } };
    const res = makeRes();

    await getBookingById(req, res);

    const [[jsonArg]] = res.json.mock.calls;
    expect(jsonArg.data.serviceAddress).toBe('123 Secret St, Dhaka');
    expect(jsonArg.data.latitude).toBe(23.777);
  });

  test('2. Provider + PENDING -> exact location omitted', async () => {
    prisma.booking.findUnique.mockResolvedValue(makeBooking({ status: 'PENDING' }));
    const req = { params: { id: 'booking-1' }, user: { id: 'provider-user-1' } };
    const res = makeRes();

    await getBookingById(req, res);

    const [[jsonArg]] = res.json.mock.calls;
    expect(jsonArg.data.serviceAddress).toBeUndefined();
    expect(jsonArg.data.latitude).toBeUndefined();
    expect(jsonArg.data.longitude).toBeUndefined();
    // statusLabel must still be attached - the sanitized object goes
    // through the same final response construction as the normal path.
    expect(jsonArg.data.statusLabel).toBeDefined();
  });

  test('3. Provider + ACCEPTED -> full location visible', async () => {
    prisma.booking.findUnique.mockResolvedValue(makeBooking({ status: 'ACCEPTED' }));
    const req = { params: { id: 'booking-1' }, user: { id: 'provider-user-1' } };
    const res = makeRes();

    await getBookingById(req, res);

    const [[jsonArg]] = res.json.mock.calls;
    expect(jsonArg.data.serviceAddress).toBe('123 Secret St, Dhaka');
  });

  test('4. Provider + later status (COMPLETED) -> full location visible', async () => {
    prisma.booking.findUnique.mockResolvedValue(makeBooking({ status: 'COMPLETED' }));
    const req = { params: { id: 'booking-1' }, user: { id: 'provider-user-1' } };
    const res = makeRes();

    await getBookingById(req, res);

    const [[jsonArg]] = res.json.mock.calls;
    expect(jsonArg.data.serviceAddress).toBe('123 Secret St, Dhaka');
  });

  test('5. Unauthorized user (neither customer nor provider) -> existing 404 behavior preserved', async () => {
    prisma.booking.findUnique.mockResolvedValue(makeBooking({ status: 'PENDING' }));
    const req = { params: { id: 'booking-1' }, user: { id: 'some-other-user' } };
    const res = makeRes();

    await getBookingById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    const [[jsonArg]] = res.json.mock.calls;
    expect(jsonArg.success).toBe(false);
  });
});
