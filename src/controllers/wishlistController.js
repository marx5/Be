const { body, query, validationResult } = require('express-validator');
const { Wishlist, Product, ProductImage, ProductVariant, CartItem, Cart, Notification } = require('../models');
const { Sequelize } = require('sequelize');
const { notificationQueue } = require('../services/queue');
const redis = require('../config/redis');

// Thêm sản phẩm vào wishlist
const addToWishlist = [
    body('productId').isInt().withMessage('Product ID must be an integer'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { productId } = req.body;
        const user = req.user;
        const cacheKey = `wishlist:${user.id}`;

        const transaction = await Sequelize.transaction();

        try {
            // Kiểm tra sản phẩm
            const product = await Product.findByPk(productId, {
                include: [{ model: ProductVariant, as: 'ProductVariants' }],
                transaction,
            });
            if (!product) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Product not found' });
            }

            // Kiểm tra trạng thái sản phẩm
            if (!product.isAvailable) {
                await transaction.rollback();
                return res.status(400).json({ error: 'Product is not available' });
            }

            // Kiểm tra tồn kho
            const totalStock = product.ProductVariants.reduce((sum, variant) => sum + variant.stock, 0);
            if (totalStock === 0) {
                await transaction.rollback();
                return res.status(400).json({ error: 'Product is out of stock' });
            }

            // Kiểm tra số lượng sản phẩm trong wishlist (tối đa 100)
            const wishlistCount = await Wishlist.count({ where: { userId: user.id }, transaction });
            if (wishlistCount >= 100) {
                await transaction.rollback();
                return res.status(400).json({ error: 'Maximum 100 items allowed in wishlist' });
            }

            // Kiểm tra sản phẩm đã có trong wishlist chưa
            const existingWishlistItem = await Wishlist.findOne({
                where: { userId: user.id, productId },
                transaction,
            });

            if (existingWishlistItem) {
                await transaction.rollback();
                return res.status(400).json({ error: 'Product is already in your wishlist' });
            }

            // Thêm sản phẩm vào wishlist
            await Wishlist.create({
                userId: user.id,
                productId,
            }, { transaction });

            await transaction.commit();

            // Xóa cache wishlist
            await redis.del(cacheKey);
            await redis.del(`all_wishlists`);

            // Gửi thông báo
            await notificationQueue.add({
                userId: user.id,
                title: 'Product Added to Wishlist',
                message: `Product #${productId} has been added to your wishlist.`,
                type: 'wishlist',
            });

            return res.status(201).json({ message: 'Product added to wishlist successfully' });
        } catch (error) {
            await transaction.rollback();
            next(error);
        }
    },
];

// Xem danh sách wishlist
const getWishlist = [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer'),
    query('categoryId').optional().isInt().withMessage('Category ID must be an integer'),
    query('sortBy').optional().isIn(['priceAsc', 'priceDesc', 'newest']).withMessage('sortBy must be priceAsc, priceDesc, or newest'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { page = 1, limit = 10, categoryId, sortBy = 'newest' } = req.query;
        const offset = (page - 1) * limit;
        const user = req.user;
        const cacheKey = `wishlist:${user.id}:page:${page}:limit:${limit}:categoryId:${categoryId || 'all'}:sortBy:${sortBy}`;

        try {
            // Kiểm tra cache
            const cachedWishlist = await redis.get(cacheKey);
            if (cachedWishlist) {
                return res.status(200).json(JSON.parse(cachedWishlist));
            }

            const where = { userId: user.id };
            const include = [
                {
                    model: Product,
                    as: 'Product',
                    attributes: ['id', 'name', 'price', 'discountPrice', 'isAvailable', 'categoryId'],
                    include: [
                        { model: ProductImage, as: 'ProductImages', where: { isPrimary: true }, required: false },
                        { model: ProductVariant, as: 'ProductVariants', attributes: ['id', 'stock'] },
                    ],
                },
            ];

            if (categoryId) {
                include[0].where = { categoryId };
            }

            let order;
            switch (sortBy) {
                case 'priceAsc':
                    order = [[{ model: Product, as: 'Product' }, 'price', 'ASC']];
                    break;
                case 'priceDesc':
                    order = [[{ model: Product, as: 'Product' }, 'price', 'DESC']];
                    break;
                default:
                    order = [['createdAt', 'DESC']];
            }

            const { count, rows } = await Wishlist.findAndCountAll({
                where,
                limit: parseInt(limit),
                offset,
                include,
                order,
            });

            // Tính tổng tồn kho cho từng sản phẩm
            const wishlistWithStock = rows.map(item => {
                const totalStock = item.Product.ProductVariants.reduce((sum, variant) => sum + variant.stock, 0);
                return {
                    ...item.toJSON(),
                    totalStock,
                };
            });

            const response = {
                wishlist: wishlistWithStock,
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

// Chuyển sản phẩm từ wishlist sang giỏ hàng
const moveToCart = [
    body('wishlistItemIds').optional().isArray().withMessage('Wishlist item IDs must be an array'),
    body('wishlistItemIds.*').optional().isInt().withMessage('Each wishlist item ID must be an integer'),
    body('selectAll').optional().isBoolean().withMessage('Select all must be a boolean'),
    body('items').optional().isArray().withMessage('Items must be an array'),
    body('items.*.wishlistItemId').optional().isInt().withMessage('Wishlist item ID must be an integer'),
    body('items.*.variantId').optional().isInt().withMessage('Variant ID must be an integer'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { wishlistItemIds, selectAll, items } = req.body;
        const user = req.user;
        const cacheKeyWishlist = `wishlist:${user.id}`;
        const cacheKeyCart = `cart:${user.id}`;

        const transaction = await Sequelize.transaction();

        try {
            let selectedItems;
            if (selectAll) {
                selectedItems = await Wishlist.findAll({
                    where: { userId: user.id },
                    transaction,
                });
            } else if (wishlistItemIds && wishlistItemIds.length > 0) {
                selectedItems = await Wishlist.findAll({
                    where: {
                        id: { [Sequelize.Op.in]: wishlistItemIds },
                        userId: user.id,
                    },
                    transaction,
                });
            } else if (items && items.length > 0) {
                selectedItems = await Wishlist.findAll({
                    where: {
                        id: { [Sequelize.Op.in]: items.map(item => item.wishlistItemId) },
                        userId: user.id,
                    },
                    transaction,
                });
            } else {
                await transaction.rollback();
                return res.status(400).json({ error: 'Either wishlistItemIds, selectAll, or items must be provided' });
            }

            if (selectedItems.length === 0) {
                await transaction.rollback();
                return res.status(400).json({ error: 'No valid items selected' });
            }

            // Tìm hoặc tạo giỏ hàng
            let cart = await Cart.findOne({ where: { userId: user.id }, transaction });
            if (!cart) {
                cart = await Cart.create({ userId: user.id }, { transaction });
            }

            // Kiểm tra giới hạn giỏ hàng (tối đa 50 sản phẩm)
            const cartItemCount = await CartItem.count({ where: { cartId: cart.id }, transaction });
            if (cartItemCount + selectedItems.length > 50) {
                await transaction.rollback();
                return res.status(400).json({ error: 'Cart limit of 50 items would be exceeded' });
            }

            const movedItems = [];
            const failedItems = [];

            for (const item of selectedItems) {
                const product = await Product.findByPk(item.productId, {
                    include: [{ model: ProductVariant, as: 'ProductVariants' }],
                    transaction,
                });

                if (!product || !product.ProductVariants || product.ProductVariants.length === 0) {
                    failedItems.push({ productId: item.productId, reason: 'Product or variants not found' });
                    continue;
                }

                // Chọn biến thể
                let variant;
                if (items && items.length > 0) {
                    const selectedItem = items.find(i => i.wishlistItemId === item.id);
                    if (selectedItem && selectedItem.variantId) {
                        variant = product.ProductVariants.find(v => v.id === selectedItem.variantId);
                    }
                }

                if (!variant) {
                    variant = product.ProductVariants[0]; // Mặc định lấy biến thể đầu tiên nếu không chọn
                }

                if (!variant) {
                    failedItems.push({ productId: item.productId, reason: 'No valid variant found' });
                    continue;
                }

                // Kiểm tra số lượng tồn kho
                if (variant.stock < 1) {
                    failedItems.push({ productId: item.productId, reason: 'Out of stock' });
                    continue;
                }

                // Kiểm tra sản phẩm đã có trong giỏ chưa
                let cartItem = await CartItem.findOne({
                    where: { cartId: cart.id, productVariantId: variant.id },
                    transaction,
                });

                if (cartItem) {
                    const newQuantity = cartItem.quantity + 1;
                    if (variant.stock < newQuantity) {
                        failedItems.push({ productId: item.productId, reason: 'Insufficient stock' });
                        continue;
                    }
                    await cartItem.update({ quantity: newQuantity }, { transaction });
                } else {
                    await CartItem.create({
                        cartId: cart.id,
                        productVariantId: variant.id,
                        quantity: 1,
                        isSelected: true,
                    }, { transaction });
                }

                // Xóa khỏi wishlist
                await Wishlist.destroy({
                    where: { id: item.id, userId: user.id },
                    transaction,
                });

                movedItems.push(item.productId);
            }

            await transaction.commit();

            // Xóa cache wishlist và giỏ hàng
            await redis.del(cacheKeyWishlist);
            await redis.del(cacheKeyCart);
            await redis.del(`all_wishlists`);

            return res.status(200).json({
                message: 'Selected items moved to cart successfully',
                movedItems,
                failedItems,
            });
        } catch (error) {
            await transaction.rollback();
            next(error);
        }
    },
];

// Các hàm khác giữ nguyên (removeFromWishlist, getAllWishlists)
const removeFromWishlist = [
    body('wishlistItemIds').optional().isArray().withMessage('Wishlist item IDs must be an array'),
    body('wishlistItemIds.*').optional().isInt().withMessage('Each wishlist item ID must be an integer'),
    body('clearAll').optional().isBoolean().withMessage('Clear all must be a boolean'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { wishlistItemIds, clearAll } = req.body;
        const user = req.user;
        const cacheKey = `wishlist:${user.id}`;

        const transaction = await Sequelize.transaction();

        try {
            if (clearAll) {
                await Wishlist.destroy({ where: { userId: user.id }, transaction });
            } else if (wishlistItemIds && wishlistItemIds.length > 0) {
                const deletedCount = await Wishlist.destroy({
                    where: {
                        id: { [Sequelize.Op.in]: wishlistItemIds },
                        userId: user.id,
                    },
                    transaction,
                });

                if (deletedCount === 0) {
                    await transaction.rollback();
                    return res.status(404).json({ error: 'No wishlist items found to delete' });
                }
            } else {
                await transaction.rollback();
                return res.status(400).json({ error: 'Either wishlistItemIds or clearAll must be provided' });
            }

            await transaction.commit();

            // Xóa cache wishlist
            await redis.del(cacheKey);
            await redis.del(`all_wishlists`);

            return res.status(200).json({ message: clearAll ? 'Wishlist cleared successfully' : 'Wishlist items removed successfully' });
        } catch (error) {
            await transaction.rollback();
            next(error);
        }
    },
];

const getAllWishlists = [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer'),
    query('userId').optional().isInt().withMessage('User ID must be an integer'),
    query('productId').optional().isInt().withMessage('Product ID must be an integer'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { page = 1, limit = 10, userId, productId } = req.query;
        const offset = (page - 1) * limit;
        const user = req.user;
        const cacheKey = `all_wishlists:page:${page}:limit:${limit}:userId:${userId || 'all'}:productId:${productId || 'all'}`;

        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Only admins can view all wishlists' });
        }

        try {
            // Kiểm tra cache
            const cachedWishlists = await redis.get(cacheKey);
            if (cachedWishlists) {
                return res.status(200).json(JSON.parse(cachedWishlists));
            }

            const where = {};
            if (userId) {
                where.userId = userId;
            }
            if (productId) {
                where.productId = productId;
            }

            const { count, rows } = await Wishlist.findAndCountAll({
                where,
                limit: parseInt(limit),
                offset,
                include: [
                    { model: User, as: 'User', attributes: ['id', 'fullName'] },
                    { model: Product, as: 'Product', attributes: ['id', 'name'] },
                ],
                order: [['createdAt', 'DESC']],
            });

            const response = {
                wishlists: rows,
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
    addToWishlist,
    getWishlist,
    removeFromWishlist,
    moveToCart,
    getAllWishlists,
};