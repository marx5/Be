const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const authMiddleware = require('../middleware/authMiddleware');
const rateLimitMiddleware = require('../middleware/rateLimitMiddleware');

// Xem danh sách thông báo (người dùng)
router.get('/', authMiddleware(), rateLimitMiddleware, notificationController.getNotifications);

// Đánh dấu thông báo đã đọc (người dùng)
router.put('/mark-as-read', authMiddleware(), rateLimitMiddleware, notificationController.markAsRead);

// Xóa thông báo (người dùng)
router.delete('/', authMiddleware(), rateLimitMiddleware, notificationController.deleteNotifications);

// Gửi thông báo hệ thống (admin)
router.post('/system', authMiddleware('admin'), rateLimitMiddleware, notificationController.sendSystemNotification);

// Xem tất cả thông báo (admin)
router.get('/all', authMiddleware('admin'), rateLimitMiddleware, notificationController.getAllNotifications);

module.exports = router;