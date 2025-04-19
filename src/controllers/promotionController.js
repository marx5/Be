const { body, query, validationResult } = require('express-validator');
const { Promotion, Order, User, Category, Product } = require('../models');
const { Sequelize } = require('sequelize');
const redis = require('../config/redis');

// Xem danh sách mã giảm giá khả dụng (người dùng)
const getAvailablePromotions = [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;
        const user = req.user;
        const cacheKey = `promotions:user:${user.id}:page:${page}:limit:${limit}`;

        try {
            // Kiểm tra cache
            const cachedPromotions = await redis.get(cacheKey);
            if (cachedPromotions) {
                return res.status(200).json(JSON.parse(cachedPromotions));
            }

            const now = new Date();
            const where = {
                startDate: { [Sequelize.Op.lte]: now },
                endDate: { [Sequelize.Op.gte]: now },
                isActive: true,
                usedCount: { [Sequelize.Op.lt]: Sequelize.col('maxUses') },
                [Sequelize.Op.or]: [
                    { userSpecific: null },
                    { userSpecific: user.id },
                ],
            };

            const availablePromotions = await Promotion.findAll({
                where,
                limit: parseInt(limit),
                offset,
                order: [['createdAt', 'DESC']],
            });

            const totalAvailable = await Promotion.count({ where });

            // Lấy tất cả mã giảm giá để hiển thị lý do không khả dụng
            const allPromotions = await Promotion.findAll({
                where: {
                    startDate: { [Sequelize.Op.lte]: now },
                    [Sequelize.Op.or]: [
                        { userSpecific: null },
                        { userSpecific: user.id },
                    ],
                },
            });

            const unavailablePromotions = allPromotions
                .filter(promotion => {
                    if (!promotion.isActive) return true;
                    if (promotion.usedCount >= promotion.maxUses) return true;
                    if (new Date(promotion.endDate) < now) return true;
                    return false;
                })
                .map(promotion => ({
                    code: promotion.code,
                    reason: !promotion.isActive ? 'Inactive' : promotion.usedCount >= promotion.maxUses ? 'Max uses reached' : 'Expired',
                }));

            const response = {
                availablePromotions,
                unavailablePromotions,
                total: totalAvailable,
                totalPages: Math.ceil(totalAvailable / limit),
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

// Tạo mã giảm giá (admin)
const createPromotion = [
    body('code').isString().withMessage('Code must be a string'),
    body('discountType').isIn(['percentage', 'fixed']).withMessage('Discount type must be percentage or fixed'),
    body('discount').isFloat({ min: 0 }).withMessage('Discount must be a non-negative number'),
    body('minOrderValue').optional().isFloat({ min: 0 }).withMessage('Minimum order value must be a non-negative number'),
    body('startDate').isISO8601().withMessage('Start date must be a valid ISO 8601 date'),
    body('endDate').isISO8601().withMessage('End date must be a valid ISO 8601 date'),
    body('maxUses').isInt({ min: 1 }).withMessage('Max uses must be a positive integer'),
    body('userSpecific').optional().isInt().withMessage('User specific must be an integer'),
    body('applicableCategoryId').optional().isInt().withMessage('Applicable category ID must be an integer'),
    body('applicableProductId').optional().isInt().withMessage('Applicable product ID must be an integer'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { code, discountType, discount, minOrderValue = 0, startDate, endDate, maxUses, userSpecific, applicableCategoryId, applicableProductId } = req.body;
        const user = req.user;

        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Only admins can create promotions' });
        }

        const transaction = await Sequelize.transaction();

        try {
            // Kiểm tra mã đã tồn tại chưa
            const existingPromotion = await Promotion.findOne({ where: { code }, transaction });
            if (existingPromotion) {
                await transaction.rollback();
                return res.status(400).json({ error: 'Promotion code already exists' });
            }

            // Kiểm tra thời gian
            const start = new Date(startDate);
            const end = new Date(endDate);
            if (start >= end) {
                await transaction.rollback();
                return res.status(400).json({ error: 'Start date must be before end date' });
            }

            // Kiểm tra userSpecific
            if (userSpecific) {
                const targetUser = await User.findByPk(userSpecific, { transaction });
                if (!targetUser) {
                    await transaction.rollback();
                    return res.status(404).json({ error: 'Target user not found' });
                }
            }

            // Kiểm tra danh mục/sản phẩm áp dụng
            if (applicableCategoryId) {
                const category = await Category.findByPk(applicableCategoryId, { transaction });
                if (!category) {
                    await transaction.rollback();
                    return res.status(404).json({ error: 'Category not found' });
                }
            }
            if (applicableProductId) {
                const product = await Product.findByPk(applicableProductId, { transaction });
                if (!product) {
                    await transaction.rollback();
                    return res.status(404).json({ error: 'Product not found' });
                }
            }

            const promotion = await Promotion.create({
                code,
                discountType,
                discount,
                minOrderValue,
                startDate: start,
                endDate: end,
                maxUses,
                usedCount: 0,
                isActive: true,
                userSpecific,
                applicableCategoryId,
                applicableProductId,
            }, { transaction });

            await transaction.commit();

            // Xóa cache danh sách mã giảm giá
            await redis.del(`promotions`);

            return res.status(201).json({ message: 'Promotion created successfully', promotion });
        } catch (error) {
            await transaction.rollback();
            next(error);
        }
    },
];

// Cập nhật mã giảm giá (admin)
const updatePromotion = [
    body('promotionId').isInt().withMessage('Promotion ID must be an integer'),
    body('code').optional().isString().withMessage('Code must be a string'),
    body('discountType').optional().isIn(['percentage', 'fixed']).withMessage('Discount type must be percentage or fixed'),
    body('discount').optional().isFloat({ min: 0 }).withMessage('Discount must be a non-negative number'),
    body('minOrderValue').optional().isFloat({ min: 0 }).withMessage('Minimum order value must be a non-negative number'),
    body('startDate').optional().isISO8601().withMessage('Start date must be a valid ISO 8601 date'),
    body('endDate').optional().isISO8601().withMessage('End date must be a valid ISO 8601 date'),
    body('maxUses').optional().isInt({ min: 1 }).withMessage('Max uses must be a positive integer'),
    body('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
    body('userSpecific').optional().isInt().withMessage('User specific must be an integer'),
    body('applicableCategoryId').optional().isInt().withMessage('Applicable category ID must be an integer'),
    body('applicableProductId').optional().isInt().withMessage('Applicable product ID must be an integer'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { promotionId, code, discountType, discount, minOrderValue, startDate, endDate, maxUses, isActive, userSpecific, applicableCategoryId, applicableProductId } = req.body;
        const user = req.user;

        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Only admins can update promotions' });
        }

        const transaction = await Sequelize.transaction();

        try {
            const promotion = await Promotion.findByPk(promotionId, { transaction });
            if (!promotion) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Promotion not found' });
            }

            // Kiểm tra mã nếu có thay đổi
            if (code && code !== promotion.code) {
                const existingPromotion = await Promotion.findOne({ where: { code }, transaction });
                if (existingPromotion) {
                    await transaction.rollback();
                    return res.status(400).json({ error: 'Promotion code already exists' });
                }
            }

            // Kiểm tra thời gian nếu có thay đổi
            const start = startDate ? new Date(startDate) : new Date(promotion.startDate);
            const end = endDate ? new Date(endDate) : new Date(promotion.endDate);
            if (startDate || endDate) {
                if (start >= end) {
                    await transaction.rollback();
                    return res.status(400).json({ error: 'Start date must be before end date' });
                }
            }

            // Kiểm tra maxUses nếu có thay đổi
            if (maxUses && maxUses < promotion.usedCount) {
                await transaction.rollback();
                return res.status(400).json({ error: 'Max uses cannot be less than current used count' });
            }

            // Kiểm tra userSpecific
            if (userSpecific !== undefined) {
                if (userSpecific) {
                    const targetUser = await User.findByPk(userSpecific, { transaction });
                    if (!targetUser) {
                        await transaction.rollback();
                        return res.status(404).json({ error: 'Target user not found' });
                    }
                }
            }

            // Kiểm tra danh mục/sản phẩm áp dụng
            if (applicableCategoryId !== undefined) {
                if (applicableCategoryId) {
                    const category = await Category.findByPk(applicableCategoryId, { transaction });
                    if (!category) {
                        await transaction.rollback();
                        return res.status(404).json({ error: 'Category not found' });
                    }
                }
            }
            if (applicableProductId !== undefined) {
                if (applicableProductId) {
                    const product = await Product.findByPk(applicableProductId, { transaction });
                    if (!product) {
                        await transaction.rollback();
                        return res.status(404).json({ error: 'Product not found' });
                    }
                }
            }

            await promotion.update({
                code: code || promotion.code,
                discountType: discountType || promotion.discountType,
                discount: discount !== undefined ? discount : promotion.discount,
                minOrderValue: minOrderValue !== undefined ? minOrderValue : promotion.minOrderValue,
                startDate: start,
                endDate: end,
                maxUses: maxUses || promotion.maxUses,
                isActive: isActive !== undefined ? isActive : promotion.isActive,
                userSpecific: userSpecific !== undefined ? userSpecific : promotion.userSpecific,
                applicableCategoryId: applicableCategoryId !== undefined ? applicableCategoryId : promotion.applicableCategoryId,
                applicableProductId: applicableProductId !== undefined ? applicableProductId : promotion.applicableProductId,
            }, { transaction });

            await transaction.commit();

            // Xóa cache danh sách mã giảm giá
            await redis.del(`promotions`);

            return res.status(200).json({ message: 'Promotion updated successfully', promotion });
        } catch (error) {
            await transaction.rollback();
            next(error);
        }
    },
];

// Xem danh sách tất cả mã giảm giá (admin)
const getAllPromotions = [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer'),
    query('status').optional().isIn(['active', 'expired']).withMessage('Status must be active or expired'),
    query('discountType').optional().isIn(['percentage', 'fixed']).withMessage('Discount type must be percentage or fixed'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { page = 1, limit = 10, status, discountType } = req.query;
        const offset = (page - 1) * limit;
        const user = req.user;
        const cacheKey = `promotions:admin:page:${page}:limit:${limit}:status:${status || 'all'}:discountType:${discountType || 'all'}`;

        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Only admins can view all promotions' });
        }

        try {
            // Kiểm tra cache
            const cachedPromotions = await redis.get(cacheKey);
            if (cachedPromotions) {
                return res.status(200).json(JSON.parse(cachedPromotions));
            }

            const where = {};
            if (status) {
                const now = new Date();
                if (status === 'active') {
                    where.startDate = { [Sequelize.Op.lte]: now };
                    where.endDate = { [Sequelize.Op.gte]: now };
                    where.isActive = true;
                } else {
                    where[Sequelize.Op.or] = [
                        { endDate: { [Sequelize.Op.lt]: now } },
                        { isActive: false },
                    ];
                }
            }
            if (discountType) {
                where.discountType = discountType;
            }

            const { count, rows } = await Promotion.findAndCountAll({
                where,
                limit: parseInt(limit),
                offset,
                include: [
                    { model: User, as: 'User', attributes: ['id', 'fullName'] },
                    { model: Category, as: 'Category', attributes: ['id', 'name'] },
                    { model: Product, as: 'Product', attributes: ['id', 'name'] },
                ],
                order: [['createdAt', 'DESC']],
            });

            // Tính số đơn hàng sử dụng mã
            const promotionsWithStats = await Promise.all(rows.map(async (promotion) => {
                const orderCount = await Order.count({ where: { promotionId: promotion.id } });
                return {
                    ...promotion.toJSON(),
                    orderCount,
                };
            }));

            const response = {
                promotions: promotionsWithStats,
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

// Các hàm khác giữ nguyên (deletePromotion)
const deletePromotion = [
    body('promotionId').isInt().withMessage('Promotion ID must be an integer'),
    async (req, res, next) => {
        const { promotionId } = req.body;
        const user = req.user;

        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Only admins can delete promotions' });
        }

        const transaction = await Sequelize.transaction();

        try {
            const promotion = await Promotion.findByPk(promotionId, { transaction });
            if (!promotion) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Promotion not found' });
            }

            // Kiểm tra xem mã có đang được sử dụng trong đơn hàng không
            const ordersUsingPromotion = await Order.count({ where: { promotionId }, transaction });
            if (ordersUsingPromotion > 0) {
                await transaction.rollback();
                return res.status(400).json({ error: 'Cannot delete promotion as it is used in existing orders' });
            }

            await promotion.destroy({ transaction });

            await transaction.commit();

            // Xóa cache danh sách mã giảm giá
            await redis.del(`promotions`);

            return res.status(200).json({ message: 'Promotion deleted successfully' });
        } catch (error) {
            await transaction.rollback();
            next(error);
        }
    },
];

module.exports = {
    getAvailablePromotions,
    createPromotion,
    updatePromotion,
    deletePromotion,
    getAllPromotions,
};