// REGRESSION: three endpoints were found during a Module 5 audit to include
// the FULL User row (via unscoped `customer: true` / `user: true` Prisma
// includes) in their response - meaning passwordHash, email, phone,
// idDocumentUrl, and selfieUrl were all being sent to the client. Two of
// these three endpoints are fully public/unauthenticated.
//
// Prisma's `select`/nested-`select` genuinely restricts which columns come
// back from the real database - a mock can't simulate that enforcement, so
// these tests instead assert on the exact query shape the code constructs
// (the `select` argument passed to prisma.*.findMany/findUnique), which is
// the actual thing that changed and the actual mechanism that provides the
// protection in production.

jest.mock('../../src/config/db', () => ({
  serviceListing: { findMany: jest.fn(), findUnique: jest.fn() },
  review: { findMany: jest.fn() },
  booking: { findUnique: jest.fn() },
  favorite: { findMany: jest.fn() },
}));
jest.mock('../../src/services/locationService', () => ({ getDistanceKm: jest.fn() }));
jest.mock('../../src/services/recommendationService', () => ({ computeRecommendationScore: jest.fn(() => 1) }));
jest.mock('../../src/notifications/notificationEngine', () => ({ notify: jest.fn() }));
jest.mock('../../src/services/walletService', () => ({
  releaseEscrowForBooking: jest.fn(),
  refundEscrowForBooking: jest.fn(),
}));
jest.mock('../../src/services/recurrenceService', () => ({ getNextOccurrence: jest.fn() }));

const prisma = require('../../src/config/db');
const { searchProviders, getListingById } = require('../../src/controllers/searchController');
const { getReviewsForProvider } = require('../../src/controllers/reviewController');
const { getBookingById } = require('../../src/controllers/bookingController');
const { listFavorites } = require('../../src/controllers/favoriteController');

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

// Every field a select clause must NOT expose.
const FORBIDDEN_FIELDS = ['passwordHash', 'email', 'phone', 'idDocumentUrl', 'selfieUrl'];

function assertSelectIsSafe(selectObj, label) {
  expect(selectObj).toBeDefined();
  FORBIDDEN_FIELDS.forEach((field) => {
    expect(selectObj[field], `${label} select must not include ${field}`).not.toBe(true);
  });
  // And it must be an actual allow-list, not `true` (which would mean "give me everything")
  expect(typeof selectObj).toBe('object');
}

describe('REGRESSION: searchController.js no longer leaks full User rows (public, unauthenticated endpoint)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('searchProviders() requests a scoped select for provider.user, not the full row', async () => {
    prisma.serviceListing.findMany.mockResolvedValue([]);
    const req = { query: {} };
    const res = makeRes();
    await searchProviders(req, res);

    const calledArgs = prisma.serviceListing.findMany.mock.calls[0][0];
    const userInclude = calledArgs.include.provider.include.user;
    expect(userInclude).not.toBe(true); // the original bug
    assertSelectIsSafe(userInclude.select, 'searchProviders provider.user');
  });

  test('getListingById() requests a scoped select for provider.user, not the full row', async () => {
    prisma.serviceListing.findUnique.mockResolvedValue(null);
    const req = { params: { id: 'listing-1' } };
    const res = makeRes();
    await getListingById(req, res);

    const calledArgs = prisma.serviceListing.findUnique.mock.calls[0][0];
    const userInclude = calledArgs.include.provider.include.user;
    expect(userInclude).not.toBe(true);
    assertSelectIsSafe(userInclude.select, 'getListingById provider.user');
  });
});

describe('REGRESSION: reviewController.js no longer leaks full User rows (public, unauthenticated endpoint)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('getReviewsForProvider() requests a scoped select for the reviewing customer, not the full row', async () => {
    prisma.review.findMany.mockResolvedValue([]);
    const req = { params: { providerId: 'provider-1' } };
    const res = makeRes();
    await getReviewsForProvider(req, res);

    const calledArgs = prisma.review.findMany.mock.calls[0][0];
    const customerInclude = calledArgs.include.booking.include.customer;
    expect(customerInclude).not.toBe(true); // the original bug
    assertSelectIsSafe(customerInclude.select, 'getReviewsForProvider booking.customer');
  });
});

describe('REGRESSION: bookingController.js loadBookingForParticipant() no longer leaks full User rows', () => {
  beforeEach(() => jest.clearAllMocks());

  test('getBookingById() requests scoped selects for both customer and provider.user', async () => {
    prisma.booking.findUnique.mockResolvedValue(null);

    const req = { params: { id: 'booking-1' }, user: { id: 'someone' } };
    const res = makeRes();
    await getBookingById(req, res);

    const calledArgs = prisma.booking.findUnique.mock.calls[0][0];
    const customerSelect = calledArgs.include.customer.select;
    const providerUserSelect = calledArgs.include.provider.include.user.select;

    expect(calledArgs.include.customer).not.toBe(true); // the original bug
    expect(calledArgs.include.provider.include.user).not.toBe(true);
    assertSelectIsSafe(customerSelect, 'loadBookingForParticipant customer');
    assertSelectIsSafe(providerUserSelect, 'loadBookingForParticipant provider.user');

    // The referral-bonus logic in customerConfirmComplete legitimately needs
    // these two fields internally - confirming the fix didn't accidentally
    // strip something the code still relies on.
    expect(customerSelect.referredById).toBe(true);
    expect(customerSelect.referralBonusGranted).toBe(true);
  });
});

describe('REGRESSION: favoriteController.js no longer leaks full User rows (found during the Module 5 follow-up audit)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('listFavorites() requests a scoped select for listing.provider.user, not the full row', async () => {
    prisma.favorite.findMany.mockResolvedValue([]);
    const req = { user: { id: 'customer-1' } };
    const res = makeRes();
    await listFavorites(req, res);

    const calledArgs = prisma.favorite.findMany.mock.calls[0][0];
    const userInclude = calledArgs.include.listing.include.provider.include.user;
    expect(userInclude).not.toBe(true); // the bug found in this follow-up audit
    assertSelectIsSafe(userInclude.select, 'listFavorites listing.provider.user');
  });
});
