const express = require('express');
const router = express.Router();
const promotionController = require('../controllers/promotionController');
const authMiddleware = require('../middleware/authMiddleware');
const rateLimitMiddleware = require('../middleware/rateLimitMiddleware');

// Xem danh sách mã giảm giá khả dụng (người dùng)
router.get('/', authMiddleware(), rateLimitMiddleware, promotionController.getAvailablePromotions);

// Tạo mã giảm giá (admin)
router.post('/', authMiddleware('admin'), rateLimitMiddleware, promotionController.createPromotion);

// Cập nhật mã giảm giá (admin)
router.put('/', authMiddleware('admin'), rateLimitMiddleware, promotionController.updatePromotion);

// Xóa mã giảm giá (admin)
router.delete('/', authMiddleware('admin'), rateLimitMiddleware, promotionController.deletePromotion);

// Xem tất cả mã giảm giá (admin)
router.get('/all', authMiddleware('admin'), rateLimitMiddleware, promotionController.getAllPromotions);

module.exports = router;