const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const openApiSpec = require('../docs/api/openapi.json');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const addressRoutes = require('./routes/addressRoutes');
const providerRoutes = require('./routes/providerRoutes');
const jobRoutes = require('./routes/jobRoutes');
const callRoutes = require('./routes/callRoutes');
const adminRoutes = require('./routes/adminRoutes');
const disputeRoutes = require('./routes/disputeRoutes');
const walletRoutes = require('./routes/walletRoutes');
const couponRoutes = require('./routes/couponRoutes');
const searchRoutes = require('./routes/searchRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const chatRoutes = require('./routes/chatRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const favoriteRoutes = require('./routes/favoriteRoutes');
const { handleStripeWebhook } = require('./controllers/paymentController');
const errorHandler = require('./middleware/errorHandler');
const prisma = require('./config/db');
const redisService = require('./services/redisService');

const app = express();

// ALLOWED_ORIGINS is a comma-separated env var (e.g. web admin panel URL).
// Empty in local dev = allow everything. Mobile app requests carry no Origin
// header, so they're unaffected by this whitelist either way.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // mobile apps / server-to-server / curl
    if (allowedOrigins.length === 0) return callback(null, true); // no whitelist set (dev)
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
}));
// Stripe webhook needs the raw request body for signature verification —
// must be registered BEFORE express.json() below, which would otherwise
// parse/consume the body first and break signature verification.
app.post('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // SSLCommerz callbacks post as form data

// আপলোড করা ছবি সরাসরি ইউআরএল দিয়ে দেখা যাবে (e.g. /uploads/xyz.jpg)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Reports actual DB/Redis connectivity instead of a static 'ok', so a
// deploy/orchestrator can detect an instance that's up but can't reach its
// dependencies. No secrets/internals exposed — just three plain statuses.
// Redis being absent/disconnected is NOT treated as unhealthy: the app is
// designed to run single-instance without it (see redisService.js), so only
// a DB failure (which the app genuinely can't function without) returns 503.
app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: 'unknown',
    redis: 'unknown',
  };
  let httpStatus = 200;

  try {
    await prisma.$queryRaw`SELECT 1`;
    health.database = 'connected';
  } catch (err) {
    health.database = 'disconnected';
    httpStatus = 503;
  }

  if (!process.env.REDIS_URL) {
    health.redis = 'not_configured';
  } else {
    const rawClient = redisService.getRawClient();
    if (rawClient) {
      try {
        await rawClient.ping();
        health.redis = 'connected';
      } catch (err) {
        health.redis = 'disconnected';
      }
    } else {
      health.redis = 'disconnected';
    }
  }

  health.status = httpStatus === 200 ? 'ok' : 'degraded';
  res.status(httpStatus).json(health);
});

app.use('/api/auth', authRoutes);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, { customSiteTitle: 'Fixify API Docs' }));
app.get('/api-docs.json', (req, res) => res.json(openApiSpec)); // raw spec, e.g. for Postman's "import from URL"
app.use('/api/users', userRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/favorites', favoriteRoutes);

// Keep error handler last
app.use(errorHandler);

module.exports = app;
