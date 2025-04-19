const { body, query, validationResult } = require('express-validator');
const { Notification, User } = require('../models');
const { Sequelize } = require('sequelize');
const { notificationQueue } = require('../services/queue');
const redis = require('../config/redis');

// Xem danh sách thông báo của người dùng
const getNotifications = [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer'),
    query('status').optional().isIn(['read', 'unread']).withMessage('Status must be read or unread'),
    query('type').optional().isIn(['order', 'review', 'wishlist', 'payment', 'system']).withMessage('Type must be order, review, wishlist, payment, or system'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { page = 1, limit = 10, status, type } = req.query;
        const offset = (page - 1) * limit;
        const user = req.user;
        const cacheKey = `notifications:${user.id}:page:${page}:limit:${limit}:status:${status || 'all'}:type:${type || 'all'}`;

        try {
            // Kiểm tra cache
            const cachedNotifications = await redis.get(cacheKey);
            if (cachedNotifications) {
                return res.status(200).json(JSON.parse(cachedNotifications));
            }

            const where = { userId: user.id };
            if (status) {
                where.status = status === 'read' ? true : false;
            }
            if (type) {
                where.type = type;
            }

            const { count, rows } = await Notification.findAndCountAll({
                where,
                limit: parseInt(limit),
                offset,
                order: [['createdAt', 'DESC']],
            });

            const response = {
                notifications: rows,
                total: count,
                totalPages: Math.ceil(count / limit),
                currentPage: parseInt(page),
            };

            // Lưu vào cache
            await redis.setex(cacheKey, 3600, JSON.stringify(response));

            return res.status(200).json(response);
        } catch (error) {
            next(error);
        }
    },
];

// Đánh dấu thông báo đã đọc
const markAsRead = [
    body('notificationIds').optional().isArray().withMessage('Notification IDs must be an array'),
    body('notificationIds.*').optional().isInt().withMessage('Each notification ID must be an integer'),
    body('markAll').optional().isBoolean().withMessage('Mark all must be a boolean'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { notificationIds, markAll } = req.body;
        const user = req.user;
        const cacheKey = `notifications:${user.id}`;

        const transaction = await Sequelize.transaction();

        try {
            if (markAll) {
                await Notification.update(
                    { status: true },
                    { where: { userId: user.id, status: false }, transaction }
                );
            } else if (notificationIds && notificationIds.length > 0) {
                const updatedCount = await Notification.update(
                    { status: true },
                    {
                        where: {
                            id: { [Sequelize.Op.in]: notificationIds },
                            userId: user.id,
                            status: false,
                        },
                        transaction,
                    }
                );

                if (updatedCount[0] === 0) {
                    await transaction.rollback();
                    return res.status(404).json({ error: 'No unread notifications found to mark as read' });
                }
            } else {
                await transaction.rollback();
                return res.status(400).json({ error: 'Either notificationIds or markAll must be provided' });
            }

            await transaction.commit();

            // Xóa cache thông báo
            await redis.del(cacheKey);

            return res.status(200).json({ message: markAll ? 'All notifications marked as read' : 'Notifications marked as read' });
        } catch (error) {
            await transaction.rollback();
            next(error);
        }
    },
];

// Xóa thông báo
const deleteNotifications = [
    body('notificationIds').optional().isArray().withMessage('Notification IDs must be an array'),
    body('notificationIds.*').optional().isInt().withMessage('Each notification ID must be an integer'),
    body('deleteAll').optional().isBoolean().withMessage('Delete all must be a boolean'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { notificationIds, deleteAll } = req.body;
        const user = req.user;
        const cacheKey = `notifications:${user.id}`;

        const transaction = await Sequelize.transaction();

        try {
            if (deleteAll) {
                await Notification.destroy({ where: { userId: user.id }, transaction });
            } else if (notificationIds && notificationIds.length > 0) {
                const deletedCount = await Notification.destroy({
                    where: {
                        id: { [Sequelize.Op.in]: notificationIds },
                        userId: user.id,
                    },
                    transaction,
                });

                if (deletedCount === 0) {
                    await transaction.rollback();
                    return res.status(404).json({ error: 'No notifications found to delete' });
                }
            } else {
                await transaction.rollback();
                return res.status(400).json({ error: 'Either notificationIds or deleteAll must be provided' });
            }

            await transaction.commit();

            // Xóa cache thông báo
            await redis.del(cacheKey);

            return res.status(200).json({ message: deleteAll ? 'All notifications deleted' : 'Notifications deleted successfully' });
        } catch (error) {
            await transaction.rollback();
            next(error);
        }
    },
];

// Gửi thông báo hệ thống (admin)
const sendSystemNotification = [
    body('title').isString().withMessage('Title must be a string'),
    body('message').isString().withMessage('Message must be a string'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { title, message } = req.body;
        const user = req.user;

        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Only admins can send system notifications' });
        }

        try {
            // Lấy tất cả người dùng
            const users = await User.findAll({ attributes: ['id'] });

            // Gửi thông báo đến từng người dùng qua hàng đợi
            for (const u of users) {
                await notificationQueue.add({
                    userId: u.id,
                    title,
                    message,
                    type: 'system',
                });
            }

            return res.status(200).json({ message: 'System notification sent successfully' });
        } catch (error) {
            next(error);
        }
    },
];

// Xem danh sách thông báo của tất cả người dùng (admin)
const getAllNotifications = [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer'),
    query('userId').optional().isInt().withMessage('User ID must be an integer'),
    query('status').optional().isIn(['read', 'unread']).withMessage('Status must be read or unread'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { page = 1, limit = 10, userId, status } = req.query;
        const offset = (page - 1) * limit;
        const user = req.user;
        const cacheKey = `all_notifications:page:${page}:limit:${limit}:userId:${userId || 'all'}:status:${status || 'all'}`;

        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Only admins can view all notifications' });
        }

        try {
            // Kiểm tra cache
            const cachedNotifications = await redis.get(cacheKey);
            if (cachedNotifications) {
                return res.status(200).json(JSON.parse(cachedNotifications));
            }

            const where = {};
            if (userId) {
                where.userId = userId;
            }
            if (status) {
                where.status = status === 'read' ? true : false;
            }

            const { count, rows } = await Notification.findAndCountAll({
                where,
                limit: parseInt(limit),
                offset,
                include: [{ model: User, as: 'User', attributes: ['id', 'fullName'] }],
                order: [['createdAt', 'DESC']],
            });

            const response = {
                notifications: rows,
                total: count,
                totalPages: Math.ceil(count / limit),
                currentPage: parseInt(page),
            };

            // Lưu vào cache
            await redis.setex(cacheKey, 3600, JSON.stringify(response));

            return res.status(200).json(response);
        } catch (error) {
            next(error);
        }
    },
];

module.exports = {
    getNotifications,
    markAsRead,
    deleteNotifications,
    sendSystemNotification,
    getAllNotifications,
};