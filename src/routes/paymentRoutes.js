const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const authMiddleware = require('../middleware/authMiddleware');
const rateLimitMiddleware = require('../middleware/rateLimitMiddleware');

// Khởi tạo thanh toán
router.post('/initiate', authMiddleware(), rateLimitMiddleware, paymentController.initiatePayment);

// Callback từ VNPay
router.get('/vnpay-callback', paymentController.vnpayCallback);

// Callback từ PayPal
router.get('/paypal-callback', authMiddleware(), paymentController.paypalCallback);

// Hủy thanh toán PayPal
router.get('/paypal-cancel', authMiddleware(), paymentController.paypalCancel);

module.exports = router;