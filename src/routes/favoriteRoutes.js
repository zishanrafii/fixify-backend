const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const { listFavorites, listFavoriteIds, addFavorite, removeFavorite } = require('../controllers/favoriteController');

router.get('/', authMiddleware, listFavorites);
router.get('/ids', authMiddleware, listFavoriteIds);
router.post('/', authMiddleware, addFavorite);
router.delete('/:listingId', authMiddleware, removeFavorite);

module.exports = router;
