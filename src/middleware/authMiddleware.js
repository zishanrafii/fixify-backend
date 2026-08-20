const jwt = require('jsonwebtoken');
const { error } = require('../utils/responseHandler');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return error(res, 'Authorization token missing', 401);
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, role, phone }
    next();
  } catch (err) {
    return error(res, 'Invalid or expired token', 401);
  }
}

// Restricts a route to specific roles, e.g. requireRole('PROVIDER')
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return error(res, 'You do not have permission to access this resource', 403);
    }
    next();
  };
}

// Blocks guest accounts from actions beyond browse/search (profile edits,
// listing creation, verification submission, booking, chat, etc.)
function blockGuest(req, res, next) {
  if (req.user && req.user.isGuest) {
    return error(res, 'এই অ্যাকশনের জন্য একটি পূর্ণাঙ্গ অ্যাকাউন্ট প্রয়োজন — Guest মোডে করা যাবে না', 403);
  }
  next();
}

module.exports = { authMiddleware, requireRole, blockGuest };
