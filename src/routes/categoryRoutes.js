const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const authMiddleware = require('../middleware/authMiddleware');

// Lấy danh sách danh mục (công khai)
router.get('/', categoryController.getCategories);

// Lấy sản phẩm trong danh mục (công khai)
router.get('/:id/products', categoryController.getProductsByCategory);

// Admin: Tạo danh mục mới
router.post('/', authMiddleware('admin'), categoryController.createCategory);

// Admin: Cập nhật danh mục
router.put('/:id', authMiddleware('admin'), categoryController.updateCategory);

// Admin: Xóa danh mục
router.delete('/:id', authMiddleware('admin'), categoryController.deleteCategory);

module.exports = router;