const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const { permissionMiddleware } = require('../middleware/permissionMiddleware');
const {
  searchProviders,
  getListingById,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} = require('../controllers/searchController');

router.get('/', searchProviders);
router.get('/listings/:id', getListingById);
router.get('/categories', listCategories);

const adminOnly = [authMiddleware, permissionMiddleware('categories.manage', 'ServiceCategory')];
router.post('/categories', adminOnly, createCategory);
router.patch('/categories/:id', adminOnly, updateCategory);
router.delete('/categories/:id', adminOnly, deleteCategory);

module.exports = router;
