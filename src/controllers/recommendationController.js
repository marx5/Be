const { query, validationResult } = require('express-validator');
const { Product, ProductImage, ProductVariant, Order, OrderItem, UserView } = require('../models');
const { Sequelize, Op } = require('sequelize');
const redis = require('../config/redis');

// Gợi ý sản phẩm dựa trên lịch sử xem/mua hàng (người dùng đăng nhập)
const getPersonalizedRecommendations = [
    query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { limit = 10 } = req.query;
        const user = req.user;
        const cacheKey = `recommendations:personalized:user:${user.id}:limit:${limit}`;

        try {
            // Kiểm tra cache
            const cachedRecommendations = await redis.get(cacheKey);
            if (cachedRecommendations) {
                return res.status(200).json(JSON.parse(cachedRecommendations));
            }

            // Lấy lịch sử xem sản phẩm
            const viewedProducts = await UserView.findAll({
                where: { userId: user.id },
                include: [{ model: Product, as: 'Product', attributes: ['categoryId'] }],
                order: [['updatedAt', 'DESC']],
                limit: 10,
            });

            // Lấy lịch sử mua hàng
            const orders = await Order.findAll({
                where: { userId: user.id, status: 'completed' },
                include: [
                    {
                        model: OrderItem,
                        as: 'OrderItems',
                        include: [
                            { model: ProductVariant, as: 'ProductVariant', include: [{ model: Product, as: 'Product', attributes: ['categoryId'] }] },
                        ],
                    },
                ],
                order: [['updatedAt', 'DESC']],
                limit: 10,
            });

            // Lấy danh mục từ lịch sử xem và mua
            const viewedCategories = viewedProducts
                .filter(view => view.Product)
                .map(view => view.Product.categoryId)
                .filter((value, index, self) => self.indexOf(value) === index);

            const purchasedCategories = orders
                .flatMap(order => order.OrderItems)
                .filter(item => item.ProductVariant && item.ProductVariant.Product)
                .map(item => item.ProductVariant.Product.categoryId)
                .filter((value, index, self) => self.indexOf(value) === index);

            const preferredCategories = [...new Set([...viewedCategories, ...purchasedCategories])];

            // Gợi ý sản phẩm từ các danh mục ưa thích
            let recommendedProducts = [];
            if (preferredCategories.length > 0) {
                recommendedProducts = await Product.findAll({
                    where: {
                        categoryId: { [Op.in]: preferredCategories },
                        isAvailable: true,
                        id: { [Op.notIn]: viewedProducts.map(view => view.productId) },
                    },
                    include: [
                        { model: ProductImage, as: 'ProductImages', where: { isPrimary: true }, required: false },
                        { model: ProductVariant, as: 'ProductVariants' },
                    ],
                    order: [['averageRating', 'DESC']],
                    limit: parseInt(limit),
                });
            }

            // Nếu không đủ sản phẩm, gợi ý thêm từ các sản phẩm phổ biến
            if (recommendedProducts.length < limit) {
                const additionalProducts = await Product.findAll({
                    where: {
                        isAvailable: true,
                        id: {
                            [Op.notIn]: [
                                ...viewedProducts.map(view => view.productId),
                                ...recommendedProducts.map(product => product.id),
                            ],
                        },
                    },
                    include: [
                        { model: ProductImage, as: 'ProductImages', where: { isPrimary: true }, required: false },
                        { model: ProductVariant, as: 'ProductVariants' },
                    ],
                    order: [['averageRating', 'DESC']],
                    limit: parseInt(limit) - recommendedProducts.length,
                });

                recommendedProducts = [...recommendedProducts, ...additionalProducts];
            }

            const response = {
                products: recommendedProducts,
            };

            // Lưu vào cache
            await redis.setex(cacheKey, 3600, JSON.stringify(response));

            return res.status(200).json(response);
        } catch (error) {
            next(error);
        }
    },
];

// Gợi ý sản phẩm liên quan (khi xem chi tiết sản phẩm)
const getRelatedProducts = [
    query('productId').isInt().withMessage('Product ID must be an integer'),
    query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { productId, limit = 5 } = req.query;
        const cacheKey = `recommendations:related:product:${productId}:limit:${limit}`;

        try {
            // Kiểm tra cache
            const cachedRelatedProducts = await redis.get(cacheKey);
            if (cachedRelatedProducts) {
                return res.status(200).json(JSON.parse(cachedRelatedProducts));
            }

            const product = await Product.findByPk(productId);
            if (!product) {
                return res.status(404).json({ error: 'Product not found' });
            }

            // Tìm sản phẩm cùng danh mục
            const relatedProducts = await Product.findAll({
                where: {
                    categoryId: product.categoryId,
                    id: { [Op.ne]: productId },
                    isAvailable: true,
                },
                include: [
                    { model: ProductImage, as: 'ProductImages', where: { isPrimary: true }, required: false },
                    { model: ProductVariant, as: 'ProductVariants' },
                ],
                order: [['averageRating', 'DESC']],
                limit: parseInt(limit),
            });

            const response = {
                products: relatedProducts,
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
    getPersonalizedRecommendations,
    getRelatedProducts,
};