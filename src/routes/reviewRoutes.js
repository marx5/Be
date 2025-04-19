const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const authMiddleware = require('../middleware/authMiddleware');
const rateLimitMiddleware = require('../middleware/rateLimitMiddleware');

// Thêm đánh giá (người dùng)
router.post('/', authMiddleware(), rateLimitMiddleware, reviewController.upload.array('images', 5), reviewController.addReview);

// Xem danh sách đánh giá của sản phẩm (công khai)
router.get('/', reviewController.getReviews);

// Sửa đánh giá (người dùng)
router.put('/', authMiddleware(), rateLimitMiddleware, reviewController.upload.array('images', 5), reviewController.updateReview);

// Xóa đánh giá (người dùng hoặc admin)
router.delete('/', authMiddleware(), rateLimitMiddleware, reviewController.deleteReview);

// Trả lời đánh giá (admin)
router.post('/reply', authMiddleware('admin'), rateLimitMiddleware, reviewController.replyToReview);

// Sửa phản hồi đánh giá (admin)
router.put('/reply', authMiddleware('admin'), rateLimitMiddleware, reviewController.updateReviewReply);

// Xóa phản hồi đánh giá (admin)
router.delete('/reply', authMiddleware('admin'), rateLimitMiddleware, reviewController.deleteReviewReply);

// Xem tất cả đánh giá (admin)
router.get('/all', authMiddleware('admin'), rateLimitMiddleware, reviewController.getAllReviews);

module.exports = router;