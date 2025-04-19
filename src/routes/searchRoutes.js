const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');
const rateLimitMiddleware = require('../middleware/rateLimitMiddleware');

// Tìm kiếm và lọc sản phẩm
router.get('/', rateLimitMiddleware, searchController.searchProducts);

// Gợi ý tìm kiếm (autocomplete)
router.get('/autocomplete', rateLimitMiddleware, searchController.autocompleteSearch);

module.exports = router;