const prisma = require('../config/db');
const { success } = require('../utils/responseHandler');

// Logged-in user's call history (as caller or callee)
async function getMyCallHistory(req, res) {
  const userId = req.user.id;

  const calls = await prisma.callLog.findMany({
    where: { OR: [{ callerId: userId }, { calleeId: userId }] },
    orderBy: { startedAt: 'desc' },
    take: 100,
  });

  return success(res, calls);
}

module.exports = { getMyCallHistory };
