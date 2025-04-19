const { body, validationResult } = require('express-validator');
const { Cart, CartItem, Product, ProductVariant, ProductImage, Promotion } = require('../models');
const { Sequelize } = require('sequelize');
const redis = require('../config/redis');

// Xem giỏ hàng
const getCart = [
    body('selectedItemIds').optional().isArray().withMessage('Selected item IDs must be an array'),
    body('selectedItemIds.*').optional().isInt().withMessage('Each selected item ID must be an integer'),
    body('promotionCode').optional().isString().withMessage('Promotion code must be a string'),
    body('selectAll').optional().isBoolean().withMessage('Select all must be a boolean'),
    body('deselectAll').optional().isBoolean().withMessage('Deselect all must be a boolean'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { selectedItemIds, promotionCode, selectAll, deselectAll } = req.body;
        const user = req.user;
        const cacheKey = `cart:${user.id}`;

        try {
            // Kiểm tra cache
            const cachedCart = await redis.get(cacheKey);
            let cart;

            if (cachedCart) {
                cart = JSON.parse(cachedCart);
            } else {
                cart = await Cart.findOne({
                    where: { userId: user.id },
                    include: [
                        {
                            model: CartItem,
                            as: 'CartItems',
                            include: [
                                {
                                    model: ProductVariant,
                                    as: 'ProductVariant',
                                    include: [
                                        { model: Product, as: 'Product', attributes: ['id', 'name', 'price', 'discountPrice'], include: [{ model: ProductImage, as: 'ProductImages', where: { isPrimary: true }, required: false, attributes: ['image', 'thumb'] }] },
                                    ],
                                    attributes: ['id', 'size', 'color', 'stock'],
                                },
                            ],
                            attributes: ['id', 'quantity', 'isSelected'],
                        },
                    ],
                });

                if (!cart) {
                    cart = await Cart.create({ userId: user.id });
                    cart = await Cart.findOne({
                        where: { userId: user.id },
                        include: [
                            {
                                model: CartItem,
                                as: 'CartItems',
                                include: [
                                    {
                                        model: ProductVariant,
                                        as: 'ProductVariant',
                                        include: [
                                            { model: Product, as: 'Product', attributes: ['id', 'name', 'price', 'discountPrice'], include: [{ model: ProductImage, as: 'ProductImages', where: { isPrimary: true }, required: false, attributes: ['image', 'thumb'] }] },
                                        ],
                                        attributes: ['id', 'size', 'color', 'stock'],
                                    },
                                ],
                                attributes: ['id', 'quantity', 'isSelected'],
                            },
                        ],
                    });
                }

                // Lưu vào cache
                await redis.setex(cacheKey, 3600, JSON.stringify(cart)); // Cache 1 giờ
            }

            // Cập nhật trạng thái chọn nếu có yêu cầu
            if (selectAll) {
                await CartItem.update(
                    { isSelected: true },
                    { where: { cartId: cart.id } }
                );
                cart.CartItems.forEach(item => (item.isSelected = true));
            } else if (deselectAll) {
                await CartItem.update(
                    { isSelected: false },
                    { where: { cartId: cart.id } }
                );
                cart.CartItems.forEach(item => (item.isSelected = false));
            } else if (selectedItemIds) {
                for (const item of cart.CartItems) {
                    const isSelected = selectedItemIds.includes(item.id);
                    if (item.isSelected !== isSelected) {
                        await CartItem.update(
                            { isSelected },
                            { where: { id: item.id, cartId: cart.id } }
                        );
                        item.isSelected = isSelected;
                    }
                }
            }

            // Cập nhật cache sau khi thay đổi trạng thái chọn
            await redis.setex(cacheKey, 3600, JSON.stringify(cart));

            // Tính toán tổng giá
            let totalPrice = 0;
            let selectedPrice = 0;
            let selectedCount = 0;

            for (const item of cart.CartItems) {
                const price = item.ProductVariant.Product.discountPrice || item.ProductVariant.Product.price;
                const itemPrice = price * item.quantity;
                totalPrice += itemPrice;
                if (item.isSelected) {
                    selectedPrice += itemPrice;
                    selectedCount += 1;
                }
            }

            let shippingFee = totalPrice >= 1000000 ? 0 : 30000;
            let selectedShippingFee = selectedPrice >= 1000000 ? 0 : 30000;
            let finalPrice = totalPrice + shippingFee;
            let selectedFinalPrice = selectedPrice + selectedShippingFee;

            // Áp dụng mã giảm giá cho giá đã chọn
            let discount = 0;
            if (promotionCode) {
                const promotion = await Promotion.findOne({
                    where: {
                        code: promotionCode,
                        startDate: { [Sequelize.Op.lte]: new Date() },
                        endDate: { [Sequelize.Op.gte]: new Date() },
                        isActive: true,
                    },
                });

                if (promotion) {
                    if (promotion.usedCount >= promotion.maxUses) {
                        return res.status(400).json({ error: 'Promotion code has reached maximum uses' });
                    }
                    discount = promotion.discountType === 'percentage'
                        ? (selectedPrice * promotion.discount) / 100
                        : promotion.discount;
                } else {
                    return res.status(400).json({ error: 'Invalid promotion code' });
                }
            }

            selectedFinalPrice -= discount;

            res.status(200).json({
                cart: {
                    items: cart.CartItems,
                    totalPrice,
                    shippingFee,
                    finalPrice,
                    selectedPrice: selectedPrice || totalPrice,
                    selectedShippingFee: selectedShippingFee || shippingFee,
                    selectedFinalPrice: selectedFinalPrice || finalPrice,
                    discount,
                    selectedCount,
                },
            });
        } catch (error) {
            next(error);
        }
    },
];

// Thêm sản phẩm vào giỏ hàng
const addToCart = [
    body('productVariantId').isInt().withMessage('Product variant ID must be an integer'),
    body('quantity').isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { productVariantId, quantity } = req.body;
        const user = req.user;
        const cacheKey = `cart:${user.id}`;
        const transaction = await Sequelize.transaction();

        try {
            // Kiểm tra biến thể
            const variant = await ProductVariant.findByPk(productVariantId, {
                include: [{ model: Product, as: 'Product' }],
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            if (!variant) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Product variant not found' });
            }

            // Kiểm tra trạng thái sản phẩm (giả định có trường isAvailable)
            if (!variant.Product.isAvailable) {
                await transaction.rollback();
                return res.status(400).json({ error: 'Product is not available' });
            }

            // Kiểm tra số lượng tồn kho
            if (variant.stock < quantity) {
                await transaction.rollback();
                return res.status(400).json({ error: 'Insufficient stock' });
            }

            // Tìm hoặc tạo giỏ hàng
            let cart = await Cart.findOne({ where: { userId: user.id }, transaction });
            if (!cart) {
                cart = await Cart.create({ userId: user.id }, { transaction });
            }

            // Kiểm tra số lượng sản phẩm trong giỏ (tối đa 50)
            const itemCount = await CartItem.count({ where: { cartId: cart.id }, transaction });
            if (itemCount >= 50) {
                await transaction.rollback();
                return res.status(400).json({ error: 'Maximum 50 items allowed in cart' });
            }

            // Tìm hoặc tạo mục trong giỏ
            let cartItem = await CartItem.findOne({
                where: { cartId: cart.id, productVariantId },
                transaction,
            });

            if (cartItem) {
                const newQuantity = cartItem.quantity + quantity;
                if (variant.stock < newQuantity) {
                    await transaction.rollback();
                    return res.status(400).json({ error: 'Insufficient stock for updated quantity' });
                }
                cartItem = await cartItem.update({ quantity: newQuantity }, { transaction });
            } else {
                cartItem = await CartItem.create({
                    cartId: cart.id,
                    productVariantId,
                    quantity,
                    isSelected: true, // Mặc định chọn khi thêm mới
                }, { transaction });
            }

            await transaction.commit();

            // Xóa cache
            await redis.del(cacheKey);

            // Lấy lại giỏ hàng để trả về
            cart = await Cart.findOne({
                where: { userId: user.id },
                include: [
                    {
                        model: CartItem,
                        as: 'CartItems',
                        include: [
                            {
                                model: ProductVariant,
                                as: 'ProductVariant',
                                include: [
                                    { model: Product, as: 'Product', attributes: ['id', 'name', 'price', 'discountPrice'], include: [{ model: ProductImage, as: 'ProductImages', where: { isPrimary: true }, required: false, attributes: ['image', 'thumb'] }] },
                                ],
                                attributes: ['id', 'size', 'color', 'stock'],
                            },
                        ],
                        attributes: ['id', 'quantity', 'isSelected'],
                    },
                ],
            });

            // Lưu vào cache
            await redis.setex(cacheKey, 3600, JSON.stringify(cart));

            let totalPrice = 0;
            let selectedPrice = 0;
            let selectedCount = 0;

            for (const item of cart.CartItems) {
                const price = item.ProductVariant.Product.discountPrice || item.ProductVariant.Product.price;
                const itemPrice = price * item.quantity;
                totalPrice += itemPrice;
                if (item.isSelected) {
                    selectedPrice += itemPrice;
                    selectedCount += 1;
                }
            }

            const shippingFee = totalPrice >= 1000000 ? 0 : 30000;
            const selectedShippingFee = selectedPrice >= 1000000 ? 0 : 30000;
            const finalPrice = totalPrice + shippingFee;
            const selectedFinalPrice = selectedPrice + selectedShippingFee;

            res.status(200).json({
                message: 'Product added to cart successfully',
                cart: {
                    items: cart.CartItems,
                    totalPrice,
                    shippingFee,
                    finalPrice,
                    selectedPrice,
                    selectedShippingFee,
                    selectedFinalPrice,
                    selectedCount,
                },
            });
        } catch (error) {
            await transaction.rollback();
            next(error);
        }
    },
];

// Cập nhật số lượng sản phẩm trong giỏ
const updateCartItem = [
    body('cartItemId').isInt().withMessage('Cart item ID must be an integer'),
    body('quantity').isInt({ min: 0 }).withMessage('Quantity must be a non-negative integer'),
    body('isSelected').optional().isBoolean().withMessage('isSelected must be a boolean'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { cartItemId, quantity, isSelected } = req.body;
        const user = req.user;
        const cacheKey = `cart:${user.id}`;
        const transaction = await Sequelize.transaction();

        try {
            const cart = await Cart.findOne({ where: { userId: user.id }, transaction });
            if (!cart) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Cart not found' });
            }

            const cartItem = await CartItem.findOne({
                where: { id: cartItemId, cartId: cart.id },
                include: [{ model: ProductVariant, as: 'ProductVariant' }],
                transaction,
                lock: transaction.LOCK.UPDATE,
            });
            if (!cartItem) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Cart item not found' });
            }

            if (quantity === 0) {
                await cartItem.destroy({ transaction });
            } else {
                // Kiểm tra số lượng tồn kho
                if (cartItem.ProductVariant.stock < quantity) {
                    await transaction.rollback();
                    return res.status(400).json({ error: 'Insufficient stock' });
                }
                await cartItem.update(
                    { quantity, isSelected: isSelected !== undefined ? isSelected : cartItem.isSelected },
                    { transaction }
                );
            }

            await transaction.commit();

            // Xóa cache
            await redis.del(cacheKey);

            // Lấy lại giỏ hàng để trả về
            const updatedCart = await Cart.findOne({
                where: { userId: user.id },
                include: [
                    {
                        model: CartItem,
                        as: 'CartItems',
                        include: [
                            {
                                model: ProductVariant,
                                as: 'ProductVariant',
                                include: [
                                    { model: Product, as: 'Product', attributes: ['id', 'name', 'price', 'discountPrice'], include: [{ model: ProductImage, as: 'ProductImages', where: { isPrimary: true }, required: false, attributes: ['image', 'thumb'] }] },
                                ],
                                attributes: ['id', 'size', 'color', 'stock'],
                            },
                        ],
                        attributes: ['id', 'quantity', 'isSelected'],
                    },
                ],
            });

            // Lưu vào cache
            await redis.setex(cacheKey, 3600, JSON.stringify(updatedCart));

            let totalPrice = 0;
            let selectedPrice = 0;
            let selectedCount = 0;

            for (const item of updatedCart.CartItems) {
                const price = item.ProductVariant.Product.discountPrice || item.ProductVariant.Product.price;
                const itemPrice = price * item.quantity;
                totalPrice += itemPrice;
                if (item.isSelected) {
                    selectedPrice += itemPrice;
                    selectedCount += 1;
                }
            }

            const shippingFee = totalPrice >= 1000000 ? 0 : 30000;
            const selectedShippingFee = selectedPrice >= 1000000 ? 0 : 30000;
            const finalPrice = totalPrice + shippingFee;
            const selectedFinalPrice = selectedPrice + selectedShippingFee;

            res.status(200).json({
                message: quantity === 0 ? 'Cart item removed successfully' : 'Cart item updated successfully',
                cart: {
                    items: updatedCart.CartItems,
                    totalPrice,
                    shippingFee,
                    finalPrice,
                    selectedPrice,
                    selectedShippingFee,
                    selectedFinalPrice,
                    selectedCount,
                },
            });
        } catch (error) {
            await transaction.rollback();
            next(error);
        }
    },
];

// Xóa sản phẩm khỏi giỏ
const removeFromCart = [
    body('cartItemIds').optional().isArray().withMessage('Cart item IDs must be an array'),
    body('cartItemIds.*').optional().isInt().withMessage('Each cart item ID must be an integer'),
    body('clearAll').optional().isBoolean().withMessage('Clear all must be a boolean'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { cartItemIds, clearAll } = req.body;
        const user = req.user;
        const cacheKey = `cart:${user.id}`;
        const transaction = await Sequelize.transaction();

        try {
            const cart = await Cart.findOne({ where: { userId: user.id }, transaction });
            if (!cart) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Cart not found' });
            }

            if (clearAll) {
                await CartItem.destroy({ where: { cartId: cart.id }, transaction });
            } else if (cartItemIds && cartItemIds.length > 0) {
                await CartItem.destroy({
                    where: {
                        id: { [Sequelize.Op.in]: cartItemIds },
                        cartId: cart.id,
                    },
                    transaction,
                });
            } else {
                await transaction.rollback();
                return res.status(400).json({ error: 'Either cartItemIds or clearAll must be provided' });
            }

            await transaction.commit();

            // Xóa cache
            await redis.del(cacheKey);

            // Lấy lại giỏ hàng để trả về
            const updatedCart = await Cart.findOne({
                where: { userId: user.id },
                include: [
                    {
                        model: CartItem,
                        as: 'CartItems',
                        include: [
                            {
                                model: ProductVariant,
                                as: 'ProductVariant',
                                include: [
                                    { model: Product, as: 'Product', attributes: ['id', 'name', 'price', 'discountPrice'], include: [{ model: ProductImage, as: 'ProductImages', where: { isPrimary: true }, required: false, attributes: ['image', 'thumb'] }] },
                                ],
                                attributes: ['id', 'size', 'color', 'stock'],
                            },
                        ],
                        attributes: ['id', 'quantity', 'isSelected'],
                    },
                ],
            });

            // Lưu vào cache
            await redis.setex(cacheKey, 3600, JSON.stringify(updatedCart));

            let totalPrice = 0;
            let selectedPrice = 0;
            let selectedCount = 0;

            for (const item of updatedCart.CartItems) {
                const price = item.ProductVariant.Product.discountPrice || item.ProductVariant.Product.price;
                const itemPrice = price * item.quantity;
                totalPrice += itemPrice;
                if (item.isSelected) {
                    selectedPrice += itemPrice;
                    selectedCount += 1;
                }
            }

            const shippingFee = totalPrice >= 1000000 ? 0 : 30000;
            const selectedShippingFee = selectedPrice >= 1000000 ? 0 : 30000;
            const finalPrice = totalPrice + shippingFee;
            const selectedFinalPrice = selectedPrice + selectedShippingFee;

            res.status(200).json({
                message: clearAll ? 'Cart cleared successfully' : 'Cart items removed successfully',
                cart: {
                    items: updatedCart.CartItems,
                    totalPrice,
                    shippingFee,
                    finalPrice,
                    selectedPrice,
                    selectedShippingFee,
                    selectedFinalPrice,
                    selectedCount,
                },
            });
        } catch (error) {
            await transaction.rollback();
            next(error);
        }
    },
];

module.exports = {
    getCart,
    addToCart,
    updateCartItem,
    removeFromCart,
};