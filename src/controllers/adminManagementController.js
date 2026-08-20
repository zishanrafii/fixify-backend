const prisma = require('../config/db');
const { success } = require('../utils/responseHandler');
const { sendCsv } = require('../utils/csvExport');

function paginationParams(req) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
  return { page, limit, skip: (page - 1) * limit };
}

// GET /api/admin/providers?search=&status=&sort=&page=&limit=&export=csv
async function listProviders(req, res) {
  const { search, status, sort = 'createdAt:desc', export: exportFormat } = req.query;
  const { page, limit, skip } = paginationParams(req);
  const [sortField, sortDir] = sort.split(':');

  const where = {
    deletedAt: null,
    ...(status && { status }),
    ...(search && {
      user: {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ],
      },
    }),
  };

  const providers = await prisma.providerProfile.findMany({
    where,
    include: { user: { select: { name: true, phone: true, email: true, isSuspended: true } } },
    orderBy: { [sortField || 'createdAt']: sortDir === 'asc' ? 'asc' : 'desc' },
    ...(exportFormat !== 'csv' && { skip, take: limit }),
  });

  if (exportFormat === 'csv') {
    const rows = providers.map((p) => ({
      id: p.id, name: p.user.name, phone: p.user.phone, status: p.status,
      avgRating: p.avgRating, totalReviews: p.totalReviews, isSuspended: p.user.isSuspended,
    }));
    return sendCsv(res, 'providers.csv', ['id', 'name', 'phone', 'status', 'avgRating', 'totalReviews', 'isSuspended'], rows);
  }

  const total = await prisma.providerProfile.count({ where });
  return success(res, { providers, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}

// GET /api/admin/bookings?status=&from=&to=&sort=&page=&limit=&export=csv
async function listBookings(req, res) {
  const { status, from, to, sort = 'createdAt:desc', export: exportFormat } = req.query;
  const { page, limit, skip } = paginationParams(req);
  const [sortField, sortDir] = sort.split(':');

  const where = {
    ...(status && { status }),
    ...((from || to) && {
      createdAt: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) },
    }),
  };

  const bookings = await prisma.booking.findMany({
    where,
    include: {
      customer: { select: { name: true, phone: true } },
      listing: { select: { title: true } },
    },
    orderBy: { [sortField || 'createdAt']: sortDir === 'asc' ? 'asc' : 'desc' },
    ...(exportFormat !== 'csv' && { skip, take: limit }),
  });

  if (exportFormat === 'csv') {
    const rows = bookings.map((b) => ({
      id: b.id, customer: b.customer.name, listing: b.listing.title, status: b.status,
      agreedPrice: b.agreedPrice, scheduledTime: b.scheduledTime, createdAt: b.createdAt,
    }));
    return sendCsv(res, 'bookings.csv', ['id', 'customer', 'listing', 'status', 'agreedPrice', 'scheduledTime', 'createdAt'], rows);
  }

  const total = await prisma.booking.count({ where });
  return success(res, { bookings, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}

module.exports = { listProviders, listBookings };
