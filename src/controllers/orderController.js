const { body, query, validationResult } = require('express-validator');
const { Cart, CartItem, Product, ProductVariant, ProductImage, Order, OrderItem, Address, Promotion, Notification } = require('../models');
const { Sequelize } = require('sequelize');
const { notificationQueue } = require('../services/queue');
const redis = require('../config/redis');

// Tạo đơn hàng từ giỏ hàng
const createOrderFromCart = [
    body('cartItemIds').optional().isArray().withMessage('Cart item IDs must be an array'),
    body('cartItemIds.*').optional().isInt().withMessage('Each cart item ID must be an integer'),
    body('selectAll').optional().isBoolean().withMessage('Select all must be a boolean'),
    body('addressId').isInt().withMessage('Address ID must be an integer'),
    body('paymentMethod').isIn(['COD', 'VNPay', 'PayPal']).withMessage('Invalid payment method'),
    body('promotionCode').optional().isString().withMessage('Promotion code must be a string'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { cartItemIds, selectAll, addressId, paymentMethod, promotionCode } = req.body;
        const user = req.user;

        let retries = 3;
        let transaction;

        while (retries > 0) {
            try {
                transaction = await Sequelize.transaction();

                const cart = await Cart.findOne({ where: { userId: user.id }, transaction });
                if (!cart) {
                    await transaction.rollback();
                    return res.status(404).json({ error: 'Cart not found' });
                }

                let selectedCartItems;
                if (selectAll) {
                    selectedCartItems = await CartItem.findAll({
                        where: { cartId: cart.id, isSelected: true },
                        include: [
                            {
                                model: ProductVariant,
                                as: 'ProductVariant',
                                include: [{ model: Product, as: 'Product' }],
                            },
                        ],
                        transaction,
                        lock: transaction.LOCK.UPDATE,
                    });
                } else if (cartItemIds && cartItemIds.length > 0) {
                    selectedCartItems = await CartItem.findAll({
                        where: {
                            id: { [Sequelize.Op.in]: cartItemIds },
                            cartId: cart.id,
                        },
                        include: [
                            {
                                model: ProductVariant,
                                as: 'ProductVariant',
                                include: [{ model: Product, as: 'Product' }],
                            },
                        ],
                        transaction,
                        lock: transaction.LOCK.UPDATE,
                    });
                } else {
                    await transaction.rollback();
                    return res.status(400).json({ error: 'Either cartItemIds or selectAll must be provided' });
                }

                if (selectedCartItems.length === 0) {
                    await transaction.rollback();
                    return res.status(400).json({ error: 'No valid items selected' });
                }

                // Kiểm tra địa chỉ
                const address = await Address.findOne({ where: { id: addressId, userId: user.id }, transaction });
                if (!address) {
                    await transaction.rollback();
                    return res.status(404).json({ error: 'Address not found' });
                }

                // Kiểm tra số lượng tồn kho
                for (const item of selectedCartItems) {
                    if (item.ProductVariant.stock < item.quantity) {
                        await transaction.rollback();
                        return res.status(400).json({ error: `Insufficient stock for ${item.ProductVariant.Product.name} (${item.ProductVariant.color}, ${item.ProductVariant.size})` });
                    }
                }

                // Kiểm tra đơn hàng pending trước đó
                const pendingOrders = await Order.count({
                    where: { userId: user.id, status: 'pending', paymentMethod: { [Sequelize.Op.ne]: 'COD' } },
                    transaction,
                });
                if (pendingOrders > 0) {
                    await transaction.rollback();
                    return res.status(400).json({ error: 'You have a pending order. Please complete or cancel it first.' });
                }

                // Tính tổng giá
                let totalPrice = 0;
                for (const item of selectedCartItems) {
                    const price = item.ProductVariant.Product.discountPrice || item.ProductVariant.Product.price;
                    totalPrice += price * item.quantity;
                }

                // Áp dụng mã giảm giá
                let discount = 0;
                let promotionId = null;
                if (promotionCode) {
                    const promotion = await Promotion.findOne({
                        where: {
                            code: promotionCode,
                            startDate: { [Sequelize.Op.lte]: new Date() },
                            endDate: { [Sequelize.Op.gte]: new Date() },
                            isActive: true,
                            [Sequelize.Op.or]: [
                                { userSpecific: null },
                                { userSpecific: user.id },
                            ],
                        },
                        transaction,
                        lock: transaction.LOCK.UPDATE,
                    });

                    if (promotion) {
                        if (promotion.usedCount >= promotion.maxUses) {
                            await transaction.rollback();
                            return res.status(400).json({ error: 'Promotion code has reached maximum uses' });
                        }

                        // Kiểm tra giá trị đơn hàng tối thiểu
                        if (totalPrice < promotion.minOrderValue) {
                            await transaction.rollback();
                            return res.status(400).json({ error: `Order total must be at least ${promotion.minOrderValue} to apply this promotion` });
                        }

                        // Kiểm tra danh mục/sản phẩm áp dụng
                        if (promotion.applicableCategoryId || promotion.applicableProductId) {
                            let isApplicable = false;
                            for (const item of selectedCartItems) {
                                if (promotion.applicableCategoryId && item.ProductVariant.Product.categoryId === promotion.applicableCategoryId) {
                                    isApplicable = true;
                                    break;
                                }
                                if (promotion.applicableProductId && item.ProductVariant.Product.id === promotion.applicableProductId) {
                                    isApplicable = true;
                                    break;
                                }
                            }
                            if (!isApplicable) {
                                await transaction.rollback();
                                return res.status(400).json({ error: 'Promotion code is not applicable to any items in your cart' });
                            }
                        }

                        discount = promotion.discountType === 'percentage'
                            ? (totalPrice * promotion.discount) / 100
                            : promotion.discount;

                        promotionId = promotion.id;
                        await promotion.update({ usedCount: promotion.usedCount + 1 }, { transaction });
                    } else {
                        await transaction.rollback();
                        return res.status(400).json({ error: 'Invalid promotion code' });
                    }
                }

                totalPrice -= discount;
                const shippingFee = totalPrice >= 1000000 ? 0 : 30000;
                const finalPrice = totalPrice + shippingFee;

                // Tạo đơn hàng
                const order = await Order.create({
                    userId: user.id,
                    addressId,
                    promotionId,
                    totalPrice: finalPrice,
                    shippingFee,
                    status: 'pending',
                    paymentMethod,
                }, { transaction });

                // Tạo các mục trong đơn hàng
                const orderItems = selectedCartItems.map(item => ({
                    orderId: order.id,
                    productVariantId: item.productVariantId,
                    quantity: item.quantity,
                    price: item.ProductVariant.Product.discountPrice || item.ProductVariant.Product.price,
                }));
                await OrderItem.bulkCreate(orderItems, { transaction });

                // Cập nhật số lượng tồn kho
                for (const item of selectedCartItems) {
                    await ProductVariant.update(
                        { stock: Sequelize.literal(`stock - ${item.quantity}`) },
                        { where: { id: item.productVariantId }, transaction }
                    );
                }

                // Xóa các mục đã đặt khỏi giỏ
                await CartItem.destroy({
                    where: {
                        id: { [Sequelize.Op.in]: selectedCartItems.map(item => item.id) },
                        cartId: cart.id,
                    },
                    transaction,
                });

                await transaction.commit();

                // Thêm vào hàng đợi để gửi thông báo
                await notificationQueue.add({
                    userId: user.id,
                    title: 'Order Created',
                    message: `Your order #${order.id} has been created successfully.`,
                    type: 'order',
                });

                // Xóa cache danh sách mã giảm giá
                await redis.del(`promotions:user:${user.id}`);

                const createdOrder = await Order.findByPk(order.id, {
                    include: [
                        { model: OrderItem, as: 'OrderItems', include: [{ model: ProductVariant, as: 'ProductVariant', include: [{ model: Product, as: 'Product' }] }] },
                        { model: Address, as: 'Address' },
                    ],
                });

                res.status(201).json({ message: 'Order created successfully', order: createdOrder });
                break;
            } catch (error) {
                retries -= 1;
                if (retries === 0 || !error.message.includes('Deadlock')) {
                    await transaction.rollback();
                    next(error);
                    break;
                }
                await transaction.rollback();
            }
        }
    },
];

// Mua ngay từ chi tiết sản phẩm
const buyNow = [
    body('productVariantId').isInt().withMessage('Product variant ID must be an integer'),
    body('quantity').isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
    body('addressId').isInt().withMessage('Address ID must be an integer'),
    body('paymentMethod').isIn(['COD', 'VNPay', 'PayPal']).withMessage('Invalid payment method'),
    body('promotionCode').optional().isString().withMessage('Promotion code must be a string'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { productVariantId, quantity, addressId, paymentMethod, promotionCode } = req.body;
        const user = req.user;

        let retries = 3;
        let transaction;

        while (retries > 0) {
            try {
                transaction = await Sequelize.transaction();

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

                // Kiểm tra số lượng tồn kho
                if (variant.stock < quantity) {
                    await transaction.rollback();
                    return res.status(400).json({ error: 'Insufficient stock' });
                }

                // Kiểm tra địa chỉ
                const address = await Address.findOne({ where: { id: addressId, userId: user.id }, transaction });
                if (!address) {
                    await transaction.rollback();
                    return res.status(404).json({ error: 'Address not found' });
                }

                // Kiểm tra đơn hàng pending trước đó
                const pendingOrders = await Order.count({
                    where: { userId: user.id, status: 'pending', paymentMethod: { [Sequelize.Op.ne]: 'COD' } },
                    transaction,
                });
                if (pendingOrders > 0) {
                    await transaction.rollback();
                    return res.status(400).json({ error: 'You have a pending order. Please complete or cancel it first.' });
                }

                // Tính tổng giá
                const price = variant.Product.discountPrice || variant.Product.price;
                let totalPrice = price * quantity;

                // Áp dụng mã giảm giá
                let discount = 0;
                let promotionId = null;
                if (promotionCode) {
                    const promotion = await Promotion.findOne({
                        where: {
                            code: promotionCode,
                            startDate: { [Sequelize.Op.lte]: new Date() },
                            endDate: { [Sequelize.Op.gte]: new Date() },
                            isActive: true,
                            [Sequelize.Op.or]: [
                                { userSpecific: null },
                                { userSpecific: user.id },
                            ],
                        },
                        transaction,
                        lock: transaction.LOCK.UPDATE,
                    });

                    if (promotion) {
                        if (promotion.usedCount >= promotion.maxUses) {
                            await transaction.rollback();
                            return res.status(400).json({ error: 'Promotion code has reached maximum uses' });
                        }

                        // Kiểm tra giá trị đơn hàng tối thiểu
                        if (totalPrice < promotion.minOrderValue) {
                            await transaction.rollback();
                            return res.status(400).json({ error: `Order total must be at least ${promotion.minOrderValue} to apply this promotion` });
                        }

                        // Kiểm tra danh mục/sản phẩm áp dụng
                        if (promotion.applicableCategoryId || promotion.applicableProductId) {
                            let isApplicable = false;
                            if (promotion.applicableCategoryId && variant.Product.categoryId === promotion.applicableCategoryId) {
                                isApplicable = true;
                            }
                            if (promotion.applicableProductId && variant.Product.id === promotion.applicableProductId) {
                                isApplicable = true;
                            }
                            if (!isApplicable) {
                                await transaction.rollback();
                                return res.status(400).json({ error: 'Promotion code is not applicable to this product' });
                            }
                        }

                        discount = promotion.discountType === 'percentage'
                            ? (totalPrice * promotion.discount) / 100
                            : promotion.discount;

                        promotionId = promotion.id;
                        await promotion.update({ usedCount: promotion.usedCount + 1 }, { transaction });
                    } else {
                        await transaction.rollback();
                        return res.status(400).json({ error: 'Invalid promotion code' });
                    }
                }

                totalPrice -= discount;
                const shippingFee = totalPrice >= 1000000 ? 0 : 30000;
                const finalPrice = totalPrice + shippingFee;

                // Tạo đơn hàng
                const order = await Order.create({
                    userId: user.id,
                    addressId,
                    promotionId,
                    totalPrice: finalPrice,
                    shippingFee,
                    status: 'pending',
                    paymentMethod,
                }, { transaction });

                // Tạo mục trong đơn hàng
                await OrderItem.create({
                    orderId: order.id,
                    productVariantId,
                    quantity,
                    price: variant.Product.discountPrice || variant.Product.price,
                }, { transaction });

                // Cập nhật số lượng tồn kho
                await ProductVariant.update(
                    { stock: Sequelize.literal(`stock - ${quantity}`) },
                    { where: { id: productVariantId }, transaction }
                );

                await transaction.commit();

                // Thêm vào hàng đợi để gửi thông báo
                await notificationQueue.add({
                    userId: user.id,
                    title: 'Order Created',
                    message: `Your order #${order.id} has been created successfully.`,
                    type: 'order',
                });

                // Xóa cache danh sách mã giảm giá
                await redis.del(`promotions:user:${user.id}`);

                const createdOrder = await Order.findByPk(order.id, {
                    include: [
                        { model: OrderItem, as: 'OrderItems', include: [{ model: ProductVariant, as: 'ProductVariant', include: [{ model: Product, as: 'Product' }] }] },
                        { model: Address, as: 'Address' },
                    ],
                });

                res.status(201).json({ message: 'Order created successfully', order: createdOrder });
                break;
            } catch (error) {
                retries -= 1;
                if (retries === 0 || !error.message.includes('Deadlock')) {
                    await transaction.rollback();
                    next(error);
                    break;
                }
                await transaction.rollback();
            }
        }
    },
];

// Hủy đơn hàng
const cancelOrder = async (req, res, next) => {
    const { id } = req.params;
    const user = req.user;

    let retries = 3;
    let transaction;

    while (retries > 0) {
        try {
            transaction = await Sequelize.transaction();

            const order = await Order.findOne({ where: { id, userId: user.id }, transaction });
            if (!order) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Order not found' });
            }

            if (order.status !== 'pending') {
                await transaction.rollback();
                return res.status(400).json({ error: 'Only pending orders can be canceled' });
            }

            await order.update({ status: 'cancelled' }, { transaction });

            // Khôi phục số lượng tồn kho
            const orderItems = await OrderItem.findAll({ where: { orderId: id }, transaction });
            for (const item of orderItems) {
                await ProductVariant.update(
                    { stock: Sequelize.literal(`stock + ${item.quantity}`) },
                    { where: { id: item.productVariantId }, transaction }
                );
            }

            await transaction.commit();

            // Thêm vào hàng đợi để gửi thông báo
            await notificationQueue.add({
                userId: user.id,
                title: 'Order Canceled',
                message: `Your order #${order.id} has been canceled.`,
                type: 'order',
            });

            res.status(200).json({ message: 'Order canceled successfully' });
            break;
        } catch (error) {
            retries -= 1;
            if (retries === 0 || !error.message.includes('Deadlock')) {
                await transaction.rollback();
                next(error);
                break;
            }
            await transaction.rollback();
        }
    }
};

// Các hàm khác giữ nguyên (getOrders, getOrderById)
const getOrders = [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer'),
    query('status').optional().isIn(['pending', 'processing', 'shipped', 'delivered', 'cancelled']).withMessage('Invalid status'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { page = 1, limit = 10, status } = req.query;
        const offset = (page - 1) * limit;
        const user = req.user;

        try {
            const where = { userId: user.id };
            if (status) {
                where.status = status;
            }

            const { count, rows } = await Order.findAndCountAll({
                where,
                limit: parseInt(limit),
                offset,
                include: [
                    { model: OrderItem, as: 'OrderItems', include: [{ model: ProductVariant, as: 'ProductVariant', include: [{ model: Product, as: 'Product', attributes: ['id', 'name'] }] }], attributes: ['id', 'quantity', 'price'] },
                    { model: Address, as: 'Address', attributes: ['id', 'address'] },
                ],
                order: [['createdAt', 'DESC']],
            });

            res.status(200).json({
                orders: rows,
                total: count,
                totalPages: Math.ceil(count / limit),
                currentPage: parseInt(page),
            });
        } catch (error) {
            next(error);
        }
    },
];

const getOrderById = async (req, res, next) => {
    const { id } = req.params;
    const user = req.user;

    try {
        const order = await Order.findOne({
            where: { id, userId: user.id },
            include: [
                { model: OrderItem, as: 'OrderItems', include: [{ model: ProductVariant, as: 'ProductVariant', include: [{ model: Product, as: 'Product', attributes: ['id', 'name'] }] }], attributes: ['id', 'quantity', 'price'] },
                { model: Address, as: 'Address', attributes: ['id', 'address'] },
            ],
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.status(200).json({ order });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createOrderFromCart,
    buyNow,
    getOrders,
    getOrderById,
    cancelOrder,
};