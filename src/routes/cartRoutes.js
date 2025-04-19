const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cartController');
const authMiddleware = require('../middleware/authMiddleware');
const rateLimitMiddleware = require('../middleware/rateLimitMiddleware');

// Xem giỏ hàng
router.get('/', authMiddleware(), rateLimitMiddleware, cartController.getCart);

// Thêm sản phẩm vào giỏ
router.post('/', authMiddleware(), rateLimitMiddleware, cartController.addToCart);

// Cập nhật số lượng sản phẩm
router.put('/', authMiddleware(), rateLimitMiddleware, cartController.updateCartItem);

// Xóa sản phẩm khỏi giỏ
router.delete('/', authMiddleware(), rateLimitMiddleware, cartController.removeFromCart);

module.exports = router;