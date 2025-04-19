const express = require('express');
const router = express.Router();
const wishlistController = require('../controllers/wishlistController');
const authMiddleware = require('../middleware/authMiddleware');
const rateLimitMiddleware = require('../middleware/rateLimitMiddleware');

// Thêm sản phẩm vào wishlist (người dùng)
router.post('/', authMiddleware(), rateLimitMiddleware, wishlistController.addToWishlist);

// Xem danh sách wishlist (người dùng)
router.get('/', authMiddleware(), rateLimitMiddleware, wishlistController.getWishlist);

// Xóa sản phẩm khỏi wishlist (người dùng)
router.delete('/', authMiddleware(), rateLimitMiddleware, wishlistController.removeFromWishlist);

// Chuyển sản phẩm từ wishlist sang giỏ hàng (người dùng)
router.post('/move-to-cart', authMiddleware(), rateLimitMiddleware, wishlistController.moveToCart);

// Xem tất cả danh sách wishlist (admin)
router.get('/all', authMiddleware('admin'), rateLimitMiddleware, wishlistController.getAllWishlists);

module.exports = router;