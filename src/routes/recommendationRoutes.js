const express = require('express');
const router = express.Router();
const recommendationController = require('../controllers/recommendationController');
const authMiddleware = require('../middleware/authMiddleware');
const rateLimitMiddleware = require('../middleware/rateLimitMiddleware');

// Gợi ý sản phẩm dựa trên lịch sử (người dùng đăng nhập)
router.get('/personalized', authMiddleware(), rateLimitMiddleware, recommendationController.getPersonalizedRecommendations);

// Gợi ý sản phẩm liên quan (công khai)
router.get('/related', rateLimitMiddleware, recommendationController.getRelatedProducts);

module.exports = router;