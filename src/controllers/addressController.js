const prisma = require('../config/db');
const { success, error } = require('../utils/responseHandler');

async function createAddress(req, res) {
  const { label, addressLine, latitude, longitude, isDefault } = req.body;

  if (isDefault) {
    await prisma.address.updateMany({
      where: { userId: req.user.id, deletedAt: null },
      data: { isDefault: false },
    });
  }

  const address = await prisma.address.create({
    data: { userId: req.user.id, label, addressLine, latitude, longitude, isDefault: !!isDefault },
  });

  return success(res, address, 'ঠিকানা যোগ হয়েছে', 201);
}

async function getMyAddresses(req, res) {
  const addresses = await prisma.address.findMany({
    where: { userId: req.user.id, deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
  return success(res, addresses);
}

async function deleteAddress(req, res) {
  const { id } = req.params;
  const address = await prisma.address.findUnique({ where: { id } });
  if (!address || address.userId !== req.user.id || address.deletedAt) {
    return error(res, 'Address not found', 404);
  }

  await prisma.address.update({ where: { id }, data: { deletedAt: new Date() } });
  return success(res, {}, 'ঠিকানা মুছে ফেলা হয়েছে');
}

module.exports = { createAddress, getMyAddresses, deleteAddress };
