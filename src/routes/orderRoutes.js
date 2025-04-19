const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const authMiddleware = require('../middleware/authMiddleware');
const rateLimitMiddleware = require('../middleware/rateLimitMiddleware');

// Tạo đơn hàng từ giỏ hàng
router.post('/', authMiddleware(), rateLimitMiddleware, orderController.createOrderFromCart);

// Mua ngay từ chi tiết sản phẩm
router.post('/buy-now', authMiddleware(), rateLimitMiddleware, orderController.buyNow);

// Xem danh sách đơn hàng
router.get('/', authMiddleware(), rateLimitMiddleware, orderController.getOrders);

// Xem chi tiết đơn hàng
router.get('/:id', authMiddleware(), rateLimitMiddleware, orderController.getOrderById);

// Hủy đơn hàng
router.put('/:id/cancel', authMiddleware(), rateLimitMiddleware, orderController.cancelOrder);

module.exports = router;