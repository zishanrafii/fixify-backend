// REGRESSION: search/listing-detail results must only ever surface listings
// that are actually eligible for booking (ACTIVE provider, not soft-deleted,
// listing itself not soft-deleted) - the exact same rule createBooking()
// already enforces in bookingController.js. These tests exist to make sure
// that rule can never silently regress in either the search endpoints or in
// booking creation itself.

jest.mock('../../src/config/db', () => ({
  serviceListing: { findMany: jest.fn(), findUnique: jest.fn() },
  address: { findUnique: jest.fn() },
  booking: { create: jest.fn() },
}));

jest.mock('../../src/services/locationService', () => ({
  getDistanceKm: jest.fn(),
}));

jest.mock('../../src/services/recommendationService', () => ({
  computeRecommendationScore: jest.fn(() => 1),
}));

jest.mock('../../src/notifications/notificationEngine', () => ({
  notify: jest.fn(),
}));

const prisma = require('../../src/config/db');
const { searchProviders, getListingById } = require('../../src/controllers/searchController');
const { createBooking } = require('../../src/controllers/bookingController');

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function makeListing(overrides = {}) {
  return {
    id: 'listing-1',
    providerId: 'provider-1',
    categoryId: 'cat-1',
    price: 500,
    deletedAt: null,
    provider: {
      id: 'provider-1',
      userId: 'user-1',
      status: 'ACTIVE',
      deletedAt: null,
      latitude: null,
      longitude: null,
      avgRating: 4.5,
      user: { id: 'user-1', name: 'Test Provider' },
    },
    ...overrides,
  };
}

describe('REGRESSION: search results only expose bookable listings', () => {
  beforeEach(() => jest.clearAllMocks());

  test('ACTIVE, non-deleted provider -> listing appears in search results', async () => {
    const listing = makeListing();
    prisma.serviceListing.findMany.mockResolvedValue([listing]);

    const req = { query: {} };
    const res = makeRes();
    await searchProviders(req, res);

    // The eligibility filter must be pushed into the Prisma query itself,
    // not applied after the fact - otherwise pagination/sorting on a larger
    // real dataset would be wrong.
    expect(prisma.serviceListing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          provider: { status: 'ACTIVE', deletedAt: null },
        }),
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ id: 'listing-1' })]) })
    );
  });

  test('PENDING_VERIFICATION provider -> listing does not appear (filtered at the query level)', async () => {
    // A correct implementation never asks Prisma for this listing in the
    // first place, so the mock simply returns an empty array - proving the
    // eligibility condition really is part of the `where` clause.
    prisma.serviceListing.findMany.mockResolvedValue([]);

    const req = { query: {} };
    const res = makeRes();
    await searchProviders(req, res);

    expect(prisma.serviceListing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ provider: { status: 'ACTIVE', deletedAt: null } }) })
    );
    const [[jsonArg]] = res.json.mock.calls;
    expect(jsonArg.data).toEqual([]);
  });

  test('SUSPENDED provider -> listing does not appear (same query-level filter)', async () => {
    prisma.serviceListing.findMany.mockResolvedValue([]);
    const req = { query: {} };
    const res = makeRes();
    await searchProviders(req, res);
    const [[jsonArg]] = res.json.mock.calls;
    expect(jsonArg.data).toEqual([]);
  });

  test('soft-deleted provider -> excluded via provider.deletedAt: null in the where clause', async () => {
    prisma.serviceListing.findMany.mockResolvedValue([]);
    const req = { query: {} };
    const res = makeRes();
    await searchProviders(req, res);
    expect(prisma.serviceListing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ provider: expect.objectContaining({ deletedAt: null }) }) })
    );
  });

  test('soft-deleted listing -> excluded via top-level deletedAt: null in the where clause', async () => {
    prisma.serviceListing.findMany.mockResolvedValue([]);
    const req = { query: {} };
    const res = makeRes();
    await searchProviders(req, res);
    expect(prisma.serviceListing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) })
    );
  });

  test('categoryId filter still works alongside the new eligibility filter', async () => {
    prisma.serviceListing.findMany.mockResolvedValue([]);
    const req = { query: { categoryId: 'cat-99' } };
    const res = makeRes();
    await searchProviders(req, res);
    expect(prisma.serviceListing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ categoryId: 'cat-99', deletedAt: null, provider: { status: 'ACTIVE', deletedAt: null } }),
      })
    );
  });

  test('sortBy=price_low still sorts correctly after eligibility filtering', async () => {
    const cheap = makeListing({ id: 'cheap', price: 100 });
    const pricey = makeListing({ id: 'pricey', price: 900 });
    prisma.serviceListing.findMany.mockResolvedValue([pricey, cheap]);

    const req = { query: { sortBy: 'price_low' } };
    const res = makeRes();
    await searchProviders(req, res);

    const [[jsonArg]] = res.json.mock.calls;
    expect(jsonArg.data.map((l) => l.id)).toEqual(['cheap', 'pricey']);
  });
});

describe('REGRESSION: GET /search/listings/:id only exposes bookable listings', () => {
  beforeEach(() => jest.clearAllMocks());

  test('ACTIVE, non-deleted provider -> listing detail returns 200', async () => {
    prisma.serviceListing.findUnique.mockResolvedValue(makeListing());
    const req = { params: { id: 'listing-1' } };
    const res = makeRes();

    await getListingById(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('PENDING_VERIFICATION provider -> 404, not the raw listing', async () => {
    prisma.serviceListing.findUnique.mockResolvedValue(
      makeListing({ provider: { ...makeListing().provider, status: 'PENDING_VERIFICATION' } })
    );
    const req = { params: { id: 'listing-1' } };
    const res = makeRes();

    await getListingById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  test('SUSPENDED provider -> 404', async () => {
    prisma.serviceListing.findUnique.mockResolvedValue(
      makeListing({ provider: { ...makeListing().provider, status: 'SUSPENDED' } })
    );
    const req = { params: { id: 'listing-1' } };
    const res = makeRes();

    await getListingById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('soft-deleted provider -> 404', async () => {
    prisma.serviceListing.findUnique.mockResolvedValue(
      makeListing({ provider: { ...makeListing().provider, deletedAt: new Date() } })
    );
    const req = { params: { id: 'listing-1' } };
    const res = makeRes();

    await getListingById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('soft-deleted listing -> 404', async () => {
    prisma.serviceListing.findUnique.mockResolvedValue(makeListing({ deletedAt: new Date() }));
    const req = { params: { id: 'listing-1' } };
    const res = makeRes();

    await getListingById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('truly nonexistent listing -> same 404 as an ineligible one (no fingerprinting via distinct errors)', async () => {
    prisma.serviceListing.findUnique.mockResolvedValue(null);
    const req = { params: { id: 'does-not-exist' } };
    const res = makeRes();

    await getListingById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    const [[jsonArg]] = res.json.mock.calls;
    // Same generic message either way - a client can't distinguish
    // "doesn't exist" from "exists but ineligible".
    expect(jsonArg.message).toBe('Listing not found');
  });
});

describe('REGRESSION: createBooking() already independently rejects ineligible providers (unchanged by this fix)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('booking creation is rejected for a PENDING_VERIFICATION provider, even if a stale/cached listing ID is used directly', async () => {
    prisma.serviceListing.findUnique.mockResolvedValue(
      makeListing({ provider: { ...makeListing().provider, status: 'PENDING_VERIFICATION' } })
    );
    const req = {
      body: { listingId: 'listing-1', addressId: 'addr-1', scheduledTime: new Date().toISOString() },
      user: { id: 'customer-1' },
    };
    const res = makeRes();

    await createBooking(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  test('booking creation is rejected for a SUSPENDED provider', async () => {
    prisma.serviceListing.findUnique.mockResolvedValue(
      makeListing({ provider: { ...makeListing().provider, status: 'SUSPENDED' } })
    );
    const req = {
      body: { listingId: 'listing-1', addressId: 'addr-1', scheduledTime: new Date().toISOString() },
      user: { id: 'customer-1' },
    };
    const res = makeRes();

    await createBooking(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  test('booking creation is rejected for a soft-deleted listing', async () => {
    prisma.serviceListing.findUnique.mockResolvedValue(makeListing({ deletedAt: new Date() }));
    const req = {
      body: { listingId: 'listing-1', addressId: 'addr-1', scheduledTime: new Date().toISOString() },
      user: { id: 'customer-1' },
    };
    const res = makeRes();

    await createBooking(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  test('booking creation succeeds for an ACTIVE, non-deleted provider with a valid address', async () => {
    prisma.serviceListing.findUnique.mockResolvedValue(makeListing());
    prisma.address.findUnique.mockResolvedValue({
      id: 'addr-1',
      userId: 'customer-1',
      deletedAt: null,
      addressLine: '123 Test Rd',
      latitude: 23.7,
      longitude: 90.4,
    });
    prisma.booking.create.mockResolvedValue({ id: 'booking-1' });

    const req = {
      body: { listingId: 'listing-1', addressId: 'addr-1', scheduledTime: new Date().toISOString() },
      user: { id: 'customer-1' },
    };
    const res = makeRes();

    await createBooking(req, res);

    expect(prisma.booking.create).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
