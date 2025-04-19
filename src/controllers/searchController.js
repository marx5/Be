const { query, validationResult } = require('express-validator');
const { Product, ProductImage, ProductVariant, Review } = require('../models');
const { Sequelize, Op } = require('sequelize');
const redis = require('../config/redis');

// Tìm kiếm và lọc sản phẩm
const searchProducts = [
    query('keyword').optional().isString().withMessage('Keyword must be a string'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer'),
    query('minPrice').optional().isFloat({ min: 0 }).withMessage('Min price must be a non-negative number'),
    query('maxPrice').optional().isFloat({ min: 0 }).withMessage('Max price must be a non-negative number'),
    query('categoryId').optional().isInt().withMessage('Category ID must be an integer'),
    query('minRating').optional().isFloat({ min: 0, max: 5 }).withMessage('Min rating must be between 0 and 5'),
    query('brand').optional().isString().withMessage('Brand must be a string'),
    query('sortBy').optional().isIn(['priceAsc', 'priceDesc', 'ratingDesc', 'newest']).withMessage('Sort by must be priceAsc, priceDesc, ratingDesc, or newest'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { keyword, page = 1, limit = 10, minPrice, maxPrice, categoryId, minRating, brand, sortBy = 'newest' } = req.query;
        const offset = (page - 1) * limit;
        const cacheKey = `search:keyword:${keyword || 'none'}:page:${page}:limit:${limit}:minPrice:${minPrice || 'none'}:maxPrice:${maxPrice || 'none'}:categoryId:${categoryId || 'none'}:minRating:${minRating || 'none'}:brand:${brand || 'none'}:sortBy:${sortBy}`;

        try {
            // Kiểm tra cache
            const cachedResults = await redis.get(cacheKey);
            if (cachedResults) {
                return res.status(200).json(JSON.parse(cachedResults));
            }

            const where = {
                isAvailable: true,
            };

            // Tìm kiếm theo từ khóa
            if (keyword) {
                where[Op.or] = [
                    { name: { [Op.like]: `%${keyword}%` } },
                    { description: { [Op.like]: `%${keyword}%` } },
                    { brand: { [Op.like]: `%${keyword}%` } },
                ];
            }

            // Lọc theo giá
            if (minPrice || maxPrice) {
                where.price = {};
                if (minPrice) {
                    where.price[Op.gte] = parseFloat(minPrice);
                }
                if (maxPrice) {
                    where.price[Op.lte] = parseFloat(maxPrice);
                }
            }

            // Lọc theo danh mục
            if (categoryId) {
                where.categoryId = parseInt(categoryId);
            }

            // Lọc theo đánh giá
            if (minRating) {
                where.averageRating = { [Op.gte]: parseFloat(minRating) };
            }

            // Lọc theo thương hiệu
            if (brand) {
                where.brand = { [Op.like]: `%${brand}%` };
            }

            // Sắp xếp
            let order;
            switch (sortBy) {
                case 'priceAsc':
                    order = [['price', 'ASC']];
                    break;
                case 'priceDesc':
                    order = [['price', 'DESC']];
                    break;
                case 'ratingDesc':
                    order = [['averageRating', 'DESC']];
                    break;
                default:
                    order = [['createdAt', 'DESC']];
            }

            const { count, rows } = await Product.findAndCountAll({
                where,
                limit: parseInt(limit),
                offset,
                include: [
                    { model: ProductImage, as: 'ProductImages', where: { isPrimary: true }, required: false },
                    { model: ProductVariant, as: 'ProductVariants' },
                ],
                order,
            });

            const response = {
                products: rows,
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

// Gợi ý tìm kiếm (autocomplete)
const autocompleteSearch = [
    query('keyword').isString().withMessage('Keyword must be a string'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { keyword } = req.query;
        const cacheKey = `autocomplete:${keyword.toLowerCase()}`;

        try {
            // Kiểm tra cache
            const cachedSuggestions = await redis.get(cacheKey);
            if (cachedSuggestions) {
                return res.status(200).json(JSON.parse(cachedSuggestions));
            }

            const suggestions = await Product.findAll({
                where: {
                    name: { [Op.like]: `%${keyword}%` },
                    isAvailable: true,
                },
                attributes: ['name'],
                limit: 10,
            });

            const response = {
                suggestions: suggestions.map(product => product.name),
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
    searchProducts,
    autocompleteSearch,
};