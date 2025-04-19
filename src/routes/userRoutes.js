const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');

/**
 * @swagger
 * /api/users/profile:
 *   get:
 *     summary: Lấy thông tin cá nhân
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Thông tin cá nhân
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         description: Không được xác thực
 */
router.get('/profile', authMiddleware(), userController.getProfile);

/**
 * @swagger
 * /api/users/profile:
 *   put:
 *     summary: Cập nhật thông tin cá nhân
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fullName
 *             properties:
 *               fullName:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Thông tin cá nhân đã được cập nhật
 *       400:
 *         description: Dữ liệu không hợp lệ
 *       401:
 *         description: Không được xác thực
 */
router.put('/profile', authMiddleware(), userController.updateProfile);

/**
 * @swagger
 * /api/users/addresses:
 *   post:
 *     summary: Thêm địa chỉ
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - address
 *             properties:
 *               address:
 *                 type: string
 *               isDefault:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Địa chỉ đã được thêm
 *       400:
 *         description: Dữ liệu không hợp lệ
 *       401:
 *         description: Không được xác thực
 */
router.post('/addresses', authMiddleware(), userController.addAddress);

/**
 * @swagger
 * /api/users/addresses:
 *   get:
 *     summary: Lấy danh sách địa chỉ
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Danh sách địa chỉ
 *       401:
 *         description: Không được xác thực
 */
router.get('/addresses', authMiddleware(), userController.getAddresses);

/**
 * @swagger
 * /api/users/addresses/{id}:
 *   put:
 *     summary: Cập nhật địa chỉ
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID địa chỉ
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - address
 *             properties:
 *               address:
 *                 type: string
 *               isDefault:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Địa chỉ đã được cập nhật
 *       400:
 *         description: Dữ liệu không hợp lệ
 *       401:
 *         description: Không được xác thực
 *       404:
 *         description: Không tìm thấy địa chỉ
 */
router.put('/addresses/:id', authMiddleware(), userController.updateAddress);

/**
 * @swagger
 * /api/users/addresses/{id}:
 *   delete:
 *     summary: Xóa địa chỉ
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID địa chỉ
 *     responses:
 *       200:
 *         description: Địa chỉ đã được xóa
 *       401:
 *         description: Không được xác thực
 *       404:
 *         description: Không tìm thấy địa chỉ
 */
router.delete('/addresses/:id', authMiddleware(), userController.deleteAddress);

/**
 * @swagger
 * /api/users/admin/users:
 *   get:
 *     summary: Lấy danh sách người dùng (Admin)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Số trang
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Số lượng người dùng mỗi trang
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Tìm kiếm theo email, tên, số điện thoại
 *     responses:
 *       200:
 *         description: Danh sách người dùng
 *       401:
 *         description: Không được xác thực
 *       403:
 *         description: Không có quyền
 */
router.get('/admin/users', authMiddleware('admin'), userController.getUsers);

module.exports = router;