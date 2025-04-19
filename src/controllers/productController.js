const multer = require('multer');
const { body, query, validationResult } = require('express-validator');
const { Product, ProductVariant, ProductImage, Category, Review, ReviewReply, Promotion, Wishlist, OrderItem, CartItem, UserView } = require('../models');
const { Sequelize } = require('sequelize');
const { processImage, deleteProductImages } = require('../utils/imageProcessor');

// Cấu hình multer để upload file
const upload = multer({
    dest: 'uploads/temp/',
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpg', 'image/jpeg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(file.mimetype)) {
            return cb(new Error('Only JPG, JPEG, PNG, and WebP images are allowed'));
        }
        cb(null, true);
    },
});

// Lấy danh sách sản phẩm (công khai)
const getProducts = [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer'),
    query('minPrice').optional().isFloat({ min: 0 }).withMessage('Min price must be a positive number'),
    query('maxPrice').optional().isFloat({ min: 0 }).withMessage('Max price must be a positive number'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { page = 1, limit = 10, search, minPrice, maxPrice, color, size, brand, categoryId, sortBy = 'createdAt', sortOrder = 'DESC' } = req.query;
        const offset = (page - 1) * limit;

        try {
            const where = {};
            if (search) {
                where[Sequelize.Op.or] = [
                    { name: { [Sequelize.Op.like]: `%${search}%` } },
                    { description: { [Sequelize.Op.like]: `%${search}%` } },
                ];
            }
            if (minPrice && maxPrice) {
                where.price = { [Sequelize.Op.between]: [minPrice, maxPrice] };
            } else if (minPrice) {
                where.price = { [Sequelize.Op.gte]: minPrice };
            } else if (maxPrice) {
                where.price = { [Sequelize.Op.lte]: maxPrice };
            }
            if (brand) {
                where.brand = brand;
            }
            if (categoryId) {
                const getAllSubCategoryIds = async (categoryId) => {
                    const subCategories = await Category.findAll({ where: { parentId: categoryId } });
                    let subCategoryIds = [categoryId];
                    for (const subCat of subCategories) {
                        const childIds = await getAllSubCategoryIds(subCat.id);
                        subCategoryIds = subCategoryIds.concat(childIds);
                    }
                    return subCategoryIds;
                };
                const categoryIds = await getAllSubCategoryIds(categoryId);
                where.categoryId = { [Sequelize.Op.in]: categoryIds };
            }

            const variantWhere = {};
            if (color) {
                variantWhere.color = color;
            }
            if (size) {
                variantWhere.size = size;
            }

            const validSortFields = ['price', 'createdAt'];
            const validSortOrders = ['ASC', 'DESC'];
            const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
            const sortDirection = validSortOrders.includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';

            const { count, rows } = await Product.findAndCountAll({
                where,
                limit: parseInt(limit),
                offset,
                order: [[sortField, sortDirection]],
                include: [
                    {
                        model: ProductVariant,
                        as: 'ProductVariants',
                        where: variantWhere,
                        required: Object.keys(variantWhere).length > 0,
                    },
                    { model: ProductImage, as: 'ProductImages', where: { isPrimary: true }, required: false },
                ],
            });

            res.status(200).json({
                products: rows,
                total: count,
                totalPages: Math.ceil(count / limit),
                currentPage: parseInt(page),
            });
        } catch (error) {
            next(error);
        }
    },
];

// Lấy chi tiết sản phẩm (công khai)
const getProductById = [
    query('reviewPage').optional().isInt({ min: 1 }).withMessage('Review page must be a positive integer'),
    query('reviewLimit').optional().isInt({ min: 1 }).withMessage('Review limit must be a positive integer'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { id } = req.params;
        const { reviewPage = 1, reviewLimit = 5 } = req.query;
        const reviewOffset = (reviewPage - 1) * reviewLimit;

        try {
            const product = await Product.findByPk(id, {
                include: [
                    { model: ProductVariant, as: 'ProductVariants' },
                    { model: ProductImage, as: 'ProductImages' },
                    { model: Category, as: 'Category' },
                    {
                        model: Review,
                        as: 'Reviews',
                        limit: parseInt(reviewLimit),
                        offset: reviewOffset,
                        include: [{ model: ReviewReply, as: 'ReviewReplies' }],
                    },
                ],
            });

            if (!product) {
                return res.status(404).json({ error: 'Product not found' });
            }

            const totalReviews = await Review.count({ where: { productId: id } });

            // Lấy các khuyến mãi liên quan
            const promotions = await Promotion.findAll({
                where: {
                    startDate: { [Sequelize.Op.lte]: new Date() },
                    endDate: { [Sequelize.Op.gte]: new Date() },
                    isActive: true,
                },
                include: [
                    {
                        model: Category,
                        as: 'Categories',
                        through: { attributes: [] },
                        where: { id: product.categoryId },
                        required: false,
                    },
                ],
            });

            // Ghi lại lịch sử xem sản phẩm nếu người dùng đã đăng nhập
            if (user) {
                await UserView.upsert({
                    userId: user.id,
                    productId: id,
                });
            }

            res.status(200).json({
                product,
                promotions,
                reviewPagination: {
                    total: totalReviews,
                    totalPages: Math.ceil(totalReviews / reviewLimit),
                    currentPage: parseInt(reviewPage),
                },
            });
        } catch (error) {
            next(error);
        }
    },
];

// Admin: Tạo sản phẩm mới
const createProduct = [
    upload.array('images', 5), // Tối đa 5 ảnh
    body('name').notEmpty().withMessage('Product name is required'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('discountPrice')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Discount price must be a positive number')
        .custom((value, { req }) => {
            if (value && value >= req.body.price) {
                throw new Error('Discount price must be less than price');
            }
            return true;
        }),
    body('categoryId').isInt().withMessage('Category ID must be an integer'),
    body('variants')
        .optional()
        .isString()
        .withMessage('Variants must be a JSON string')
        .customSanitizer(value => {
            try {
                return JSON.parse(value);
            } catch (error) {
                throw new Error('Variants must be a valid JSON string');
            }
        })
        .custom(variants => {
            if (variants) {
                if (variants.length > 20) {
                    throw new Error('Maximum 20 variants allowed');
                }
                for (const v of variants) {
                    if (!v.size || !v.color || typeof v.stock !== 'number' || v.stock < 0) {
                        throw new Error('Each variant must have size, color, and stock (non-negative)');
                    }
                }
            }
            return true;
        }),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { name, description, price, discountPrice, categoryId, stock, material, brand, variants } = req.body;
        const files = req.files;

        try {
            // Kiểm tra danh mục
            const category = await Category.findByPk(categoryId);
            if (!category) {
                return res.status(404).json({ error: 'Category not found' });
            }

            // Kiểm tra trùng tên sản phẩm
            const existingProduct = await Product.findOne({ where: { name } });
            if (existingProduct) {
                return res.status(400).json({ error: 'Product name already exists' });
            }

            // Tạo sản phẩm
            const product = await Product.create({
                name,
                description,
                price,
                discountPrice,
                categoryId,
                stock,
                material,
                brand,
            });

            // Tạo biến thể
            if (variants) {
                const parsedVariants = JSON.parse(variants);
                const variantData = parsedVariants.map(v => ({
                    productId: product.id,
                    size: v.size,
                    color: v.color,
                    stock: v.stock || 0,
                }));
                await ProductVariant.bulkCreate(variantData);
            }

            // Tạo hình ảnh
            const imageData = [];
            if (files && files.length > 0) {
                for (let i = 0; i < files.length; i++) {
                    const { image, thumb } = await processImage(files[i], product.id, i);
                    imageData.push({
                        productId: product.id,
                        image,
                        thumb,
                        isPrimary: i === 0, // Ảnh đầu tiên là ảnh chính
                    });
                }
                await ProductImage.bulkCreate(imageData);
            }

            const createdProduct = await Product.findByPk(product.id, {
                include: [
                    { model: ProductVariant, as: 'ProductVariants' },
                    { model: ProductImage, as: 'ProductImages' },
                ],
            });

            res.status(201).json({ message: 'Product created successfully', product: createdProduct });
        } catch (error) {
            next(error);
        } finally {
            // Xóa file tạm sau khi xử lý
            if (files && files.length > 0) {
                for (const file of files) {
                    await fs.unlink(file.path).catch(() => { });
                }
            }
        }
    },
];

// Admin: Cập nhật sản phẩm
const updateProduct = [
    upload.array('images', 5),
    body('name').optional().notEmpty().withMessage('Product name cannot be empty'),
    body('price').optional().isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('discountPrice')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Discount price must be a positive number')
        .custom((value, { req }) => {
            const price = req.body.price || req.product?.price;
            if (value && price && value >= price) {
                throw new Error('Discount price must be less than price');
            }
            return true;
        }),
    body('categoryId').optional().isInt().withMessage('Category ID must be an integer'),
    body('variants')
        .optional()
        .isString()
        .withMessage('Variants must be a JSON string')
        .customSanitizer(value => {
            try {
                return JSON.parse(value);
            } catch (error) {
                throw new Error('Variants must be a valid JSON string');
            }
        })
        .custom(variants => {
            if (variants) {
                if (variants.length > 20) {
                    throw new Error('Maximum 20 variants allowed');
                }
                for (const v of variants) {
                    if (!v.size || !v.color || typeof v.stock !== 'number' || v.stock < 0) {
                        throw new Error('Each variant must have size, color, and stock (non-negative)');
                    }
                }
            }
            return true;
        }),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { id } = req.params;
        const { name, description, price, discountPrice, categoryId, stock, material, brand, variants } = req.body;
        const files = req.files;

        try {
            const product = await Product.findByPk(id);
            if (!product) {
                return res.status(404).json({ error: 'Product not found' });
            }

            // Kiểm tra danh mục
            if (categoryId) {
                const category = await Category.findByPk(categoryId);
                if (!category) {
                    return res.status(404).json({ error: 'Category not found' });
                }
            }

            // Kiểm tra trùng tên sản phẩm
            if (name && name !== product.name) {
                const existingProduct = await Product.findOne({ where: { name, id: { [Sequelize.Op.ne]: id } } });
                if (existingProduct) {
                    return res.status(400).json({ error: 'Product name already exists' });
                }
            }

            // Cập nhật sản phẩm
            await product.update({
                name,
                description,
                price,
                discountPrice,
                categoryId,
                stock,
                material,
                brand,
            });

            // Cập nhật biến thể
            if (variants) {
                const parsedVariants = JSON.parse(variants);
                const existingVariants = await ProductVariant.findAll({ where: { productId: id } });
                const newVariants = parsedVariants.map(v => ({
                    productId: id,
                    size: v.size,
                    color: v.color,
                    stock: v.stock || 0,
                }));

                // Xóa biến thể không còn trong danh sách
                const newVariantKeys = newVariants.map(v => `${v.size}-${v.color}`);
                for (const variant of existingVariants) {
                    const variantKey = `${variant.size}-${variant.color}`;
                    if (!newVariantKeys.includes(variantKey)) {
                        await variant.destroy();
                    }
                }

                // Cập nhật hoặc tạo biến thể mới
                for (const variant of newVariants) {
                    const variantKey = `${variant.size}-${variant.color}`;
                    const existingVariant = existingVariants.find(v => `${v.size}-${v.color}` === variantKey);
                    if (existingVariant) {
                        await existingVariant.update({ stock: variant.stock });
                    } else {
                        await ProductVariant.create(variant);
                    }
                }
            }

            // Cập nhật hình ảnh
            const existingImages = await ProductImage.findAll({ where: { productId: id } });
            if (files && files.length > 0) {
                // Xóa hình ảnh cũ
                await deleteProductImages(id);
                await ProductImage.destroy({ where: { productId: id } });

                // Tạo hình ảnh mới
                const imageData = [];
                for (let i = 0; i < files.length; i++) {
                    const { image, thumb } = await processImage(files[i], id, i);
                    imageData.push({
                        productId: id,
                        image,
                        thumb,
                        isPrimary: i === 0,
                    });
                }
                await ProductImage.bulkCreate(imageData);
            }

            const updatedProduct = await Product.findByPk(id, {
                include: [
                    { model: ProductVariant, as: 'ProductVariants' },
                    { model: ProductImage, as: 'ProductImages' },
                ],
            });

            res.status(200).json({ message: 'Product updated successfully', product: updatedProduct });
        } catch (error) {
            next(error);
        } finally {
            // Xóa file tạm sau khi xử lý
            if (files && files.length > 0) {
                for (const file of files) {
                    await fs.unlink(file.path).catch(() => { });
                }
            }
        }
    },
];

// Admin: Xóa sản phẩm
const deleteProduct = async (req, res, next) => {
    const { id } = req.params;

    try {
        const product = await Product.findByPk(id);
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // Kiểm tra sản phẩm trong đơn hàng
        const orderItems = await OrderItem.count({ where: { productVariantId: { [Sequelize.Op.in]: Sequelize.literal(`(SELECT id FROM ProductVariants WHERE productId = ${id})`) } } });
        if (orderItems > 0) {
            return res.status(400).json({ error: 'Cannot delete product that exists in orders' });
        }

        // Xóa các dữ liệu liên quan
        await ProductVariant.destroy({ where: { productId: id } });
        await ProductImage.destroy({ where: { productId: id } });
        await Review.destroy({ where: { productId: id } });
        await Wishlist.destroy({ where: { productId: id } });
        await CartItem.destroy({ where: { productVariantId: { [Sequelize.Op.in]: Sequelize.literal(`(SELECT id FROM ProductVariants WHERE productId = ${id})`) } } });
        await deleteProductImages(id);

        await product.destroy();

        res.status(200).json({ message: 'Product deleted successfully' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
    upload,
};