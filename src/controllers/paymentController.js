const axios = require('axios');
const crypto = require('crypto');
const querystring = require('querystring');
const { body, query, validationResult } = require('express-validator');
const { Order, OrderItem, ProductVariant, Product, PaymentTransaction, Notification } = require('../models');
const { Sequelize } = require('sequelize');
const { notificationQueue } = require('../services/queue');
const redis = require('../config/redis');

// Khởi tạo thanh toán
const initiatePayment = [
    body('orderId').isInt().withMessage('Order ID must be an integer'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { orderId } = req.body;
        const user = req.user;

        const transaction = await Sequelize.transaction();

        try {
            const order = await Order.findOne({
                where: { id: orderId, userId: user.id },
                include: [
                    { model: OrderItem, as: 'OrderItems', include: [{ model: ProductVariant, as: 'ProductVariant', include: [{ model: Product, as: 'Product' }] }] },
                ],
                transaction,
            });

            if (!order) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Order not found' });
            }

            if (order.status !== 'pending') {
                await transaction.rollback();
                return res.status(400).json({ error: 'Order cannot be processed' });
            }

            // Kiểm tra số lần khởi tạo thanh toán (tối đa 3 lần)
            const paymentAttempts = await PaymentTransaction.findAll({
                where: { orderId, status: 'initiated' },
                transaction,
            });

            if (paymentAttempts.length >= 3) {
                await transaction.rollback();
                return res.status(400).json({ error: 'Maximum payment initiation attempts reached' });
            }

            // Kiểm tra thời gian khởi tạo (24 giờ kể từ lần đầu tiên)
            if (paymentAttempts.length > 0) {
                const firstAttempt = paymentAttempts[0];
                const now = new Date();
                const diffHours = (now - new Date(firstAttempt.createdAt)) / (1000 * 60 * 60);
                if (diffHours > 24) {
                    await transaction.rollback();
                    return res.status(400).json({ error: 'Payment initiation window (24 hours) has expired. Please create a new order.' });
                }
            }

            const paymentMethod = order.paymentMethod;

            // Lưu giao dịch tạm thời
            const paymentTransaction = await PaymentTransaction.create({
                orderId,
                paymentMethod,
                status: 'initiated',
                amount: order.totalPrice,
                currency: 'VND',
            }, { transaction });

            if (paymentMethod === 'COD') {
                await order.update({ status: 'processing' }, { transaction });
                await paymentTransaction.update({ status: 'completed' }, { transaction });

                await transaction.commit();

                await notificationQueue.add({
                    userId: user.id,
                    title: 'Order Processing',
                    message: `Your order #${order.id} is being processed for Cash on Delivery.`,
                    type: 'payment',
                });

                return res.status(200).json({ message: 'COD payment initiated successfully', order });
            } else if (paymentMethod === 'VNPay') {
                const vnpayUrl = await initiateVNPayPayment(order, paymentTransaction, req);
                await transaction.commit();

                await notificationQueue.add({
                    userId: user.id,
                    title: 'Payment Initiated',
                    message: `Your order #${order.id} payment has been initiated via VNPay.`,
                    type: 'payment',
                });

                return res.status(200).json({ message: 'VNPay payment initiated', paymentUrl: vnpayUrl });
            } else if (paymentMethod === 'PayPal') {
                const paypalUrl = await initiatePayPalPayment(order, paymentTransaction, req);
                await transaction.commit();

                await notificationQueue.add({
                    userId: user.id,
                    title: 'Payment Initiated',
                    message: `Your order #${order.id} payment has been initiated via PayPal.`,
                    type: 'payment',
                });

                return res.status(200).json({ message: 'PayPal payment initiated', paymentUrl: paypalUrl });
            } else {
                await transaction.rollback();
                return res.status(400).json({ error: 'Unsupported payment method' });
            }
        } catch (error) {
            await transaction.rollback();
            next(error);
        }
    },
];

// Khởi tạo thanh toán VNPay
const initiateVNPayPayment = async (order, paymentTransaction, req) => {
    const vnp_TmnCode = process.env.VNPAY_TMN_CODE;
    const vnp_HashSecret = process.env.VNPAY_HASH_SECRET;
    const vnp_Url = process.env.VNPAY_URL;
    const returnUrl = `http://localhost:5000/api/payments/vnpay-callback`;

    if (order.totalPrice < 0) {
        throw new Error('Order amount cannot be negative');
    }

    const date = new Date();
    const createDate = date.toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const vnp_TxnRef = paymentTransaction.id; // Sử dụng ID giao dịch thay vì orderId
    const vnp_Amount = order.totalPrice * 100; // VNPay yêu cầu số tiền nhân 100
    const vnp_OrderInfo = `Payment for order #${order.id}`;
    const vnp_OrderType = '250000'; // Loại hàng hóa (e-commerce)
    const vnp_Locale = 'vn';
    const vnp_IpAddr = req.ip;

    let vnp_Params = {
        vnp_Version: '2.1.0',
        vnp_Command: 'pay',
        vnp_TmnCode,
        vnp_Amount,
        vnp_CreateDate: createDate,
        vnp_CurrCode: 'VND',
        vnp_IpAddr,
        vnp_Locale,
        vnp_OrderInfo,
        vnp_OrderType,
        vnp_ReturnUrl: returnUrl,
        vnp_TxnRef,
    };

    // Sắp xếp tham số theo thứ tự alphabet
    vnp_Params = sortObject(vnp_Params);

    // Tạo checksum
    const signData = querystring.stringify(vnp_Params, { encode: false });
    const hmac = crypto.createHmac('sha512', vnp_HashSecret);
    const vnp_SecureHash = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
    vnp_Params['vnp_SecureHash'] = vnp_SecureHash;

    // Lưu tham số giao dịch vào Redis để đối chiếu sau
    await redis.setex(`vnpay:${vnp_TxnRef}`, 3600, JSON.stringify(vnp_Params));

    const vnpayUrl = `${vnp_Url}?${querystring.stringify(vnp_Params, { encode: false })}`;
    return vnpayUrl;
};

// Xử lý callback từ VNPay
const vnpayCallback = async (req, res, next) => {
    const vnp_Params = req.query;
    const secureHash = vnp_Params['vnp_SecureHash'];

    delete vnp_Params['vnp_SecureHash'];
    delete vnp_Params['vnp_SecureHashType'];

    const vnp_HashSecret = process.env.VNPAY_HASH_SECRET;
    const signData = querystring.stringify(sortObject(vnp_Params), { encode: false });
    const hmac = crypto.createHmac('sha512', vnp_HashSecret);
    const checkSum = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

    const transaction = await Sequelize.transaction();

    try {
        if (secureHash === checkSum) {
            const paymentTransactionId = vnp_Params['vnp_TxnRef'];
            const vnp_ResponseCode = vnp_Params['vnp_ResponseCode'];
            const vnp_TransactionNo = vnp_Params['vnp_TransactionNo'];

            const paymentTransaction = await PaymentTransaction.findByPk(paymentTransactionId, { transaction });
            if (!paymentTransaction) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Payment transaction not found' });
            }

            const order = await Order.findByPk(paymentTransaction.orderId, { transaction });
            if (!order) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Order not found' });
            }

            if (paymentTransaction.status !== 'initiated') {
                await transaction.rollback();
                return res.status(400).json({ error: 'Payment transaction already processed' });
            }

            if (vnp_ResponseCode === '00') {
                await order.update({ status: 'completed' }, { transaction });
                await paymentTransaction.update({
                    status: 'completed',
                    transactionId: vnp_TransactionNo,
                    responseCode: vnp_ResponseCode,
                    responseMessage: 'Payment successful',
                }, { transaction });

                await notificationQueue.add({
                    userId: order.userId,
                    title: 'Payment Successful',
                    message: `Your payment for order #${order.id} via VNPay was successful.`,
                    type: 'payment',
                });
            } else {
                await order.update({ status: 'failed' }, { transaction });
                await paymentTransaction.update({
                    status: 'failed',
                    transactionId: vnp_TransactionNo,
                    responseCode: vnp_ResponseCode,
                    responseMessage: 'Payment failed',
                }, { transaction });

                await notificationQueue.add({
                    userId: order.userId,
                    title: 'Payment Failed',
                    message: `Your payment for order #${order.id} via VNPay failed.`,
                    type: 'payment',
                });
            }

            await transaction.commit();
            await redis.del(`vnpay:${paymentTransactionId}`);
            return res.status(200).json({ message: 'Payment processed successfully', vnp_ResponseCode });
        } else {
            await transaction.rollback();
            return res.status(400).json({ error: 'Checksum verification failed' });
        }
    } catch (error) {
        await transaction.rollback();
        next(error);
    }
};

// Khởi tạo thanh toán PayPal
const initiatePayPalPayment = async (order, paymentTransaction, req) => {
    const accessToken = await getPayPalAccessToken();
    const paypalUrl = process.env.PAYPAL_API_URL;

    // Lấy tỷ giá từ API (giả lập, có thể thay bằng API thực tế như exchangeratesapi.io)
    const exchangeRate = 23000; // 1 USD = 23000 VNĐ (giả lập)

    const amountInUSD = (order.totalPrice / exchangeRate).toFixed(2);

    const requestBody = {
        intent: 'CAPTURE',
        purchase_units: [
            {
                amount: {
                    currency_code: 'USD',
                    value: amountInUSD,
                },
                description: `Payment for order #${order.id}`,
            },
        ],
        application_context: {
            return_url: `http://localhost:5000/api/payments/paypal-callback?orderId=${order.id}`,
            cancel_url: `http://localhost:5000/api/payments/paypal-cancel?orderId=${order.id}`,
        },
    };

    const response = await axios.post(`${paypalUrl}/v2/checkout/orders`, requestBody, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
        },
    });

    const approvalUrl = response.data.links.find(link => link.rel === 'approve').href;
    const paypalToken = response.data.id;

    // Lưu token vào Redis để đối chiếu
    await redis.setex(`paypal:${paymentTransaction.id}`, 3600, paypalToken);

    return approvalUrl;
};

// Lấy PayPal Access Token
const getPayPalAccessToken = async () => {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    const paypalUrl = process.env.PAYPAL_API_URL;

    const response = await axios.post(`${paypalUrl}/v1/oauth2/token`, 'grant_type=client_credentials', {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        },
    });

    return response.data.access_token;
};

// Xử lý callback từ PayPal
const paypalCallback = async (req, res, next) => {
    const { orderId, token } = req.query;
    const user = req.user;

    const transaction = await Sequelize.transaction();

    try {
        const order = await Order.findOne({ where: { id: orderId, userId: user.id }, transaction });
        if (!order) {
            await transaction.rollback();
            return res.status(404).json({ error: 'Order not found' });
        }

        const paymentTransaction = await PaymentTransaction.findOne({
            where: { orderId, paymentMethod: 'PayPal', status: 'initiated' },
            transaction,
        });

        if (!paymentTransaction) {
            await transaction.rollback();
            return res.status(404).json({ error: 'Payment transaction not found' });
        }

        const cachedToken = await redis.get(`paypal:${paymentTransaction.id}`);
        if (cachedToken !== token) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Invalid PayPal token' });
        }

        const accessToken = await getPayPalAccessToken();
        const paypalUrl = process.env.PAYPAL_API_URL;

        // Capture payment
        const captureResponse = await axios.post(`${paypalUrl}/v2/checkout/orders/${token}/capture`, {}, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
            },
        });

        if (captureResponse.data.status === 'COMPLETED') {
            await order.update({ status: 'completed' }, { transaction });
            await paymentTransaction.update({
                status: 'completed',
                transactionId: captureResponse.data.id,
                responseCode: captureResponse.data.status,
                responseMessage: 'Payment successful',
                currency: 'USD',
            }, { transaction });

            await notificationQueue.add({
                userId: user.id,
                title: 'Payment Successful',
                message: `Your payment for order #${order.id} via PayPal was successful.`,
                type: 'payment',
            });
        } else {
            await order.update({ status: 'failed' }, { transaction });
            await paymentTransaction.update({
                status: 'failed',
                transactionId: captureResponse.data.id,
                responseCode: captureResponse.data.status,
                responseMessage: 'Payment failed',
            }, { transaction });

            await notificationQueue.add({
                userId: user.id,
                title: 'Payment Failed',
                message: `Your payment for order #${order.id} via PayPal failed.`,
                type: 'payment',
            });
        }

        await transaction.commit();
        await redis.del(`paypal:${paymentTransaction.id}`);
        return res.redirect('/payment-success'); // Redirect to a success page (client-side)
    } catch (error) {
        await transaction.rollback();
        next(error);
    }
};

// Xử lý hủy thanh toán PayPal
const paypalCancel = async (req, res, next) => {
    const { orderId } = req.query;
    const user = req.user;

    const transaction = await Sequelize.transaction();

    try {
        const order = await Order.findOne({ where: { id: orderId, userId: user.id }, transaction });
        if (!order) {
            await transaction.rollback();
            return res.status(404).json({ error: 'Order not found' });
        }

        const paymentTransaction = await PaymentTransaction.findOne({
            where: { orderId, paymentMethod: 'PayPal', status: 'initiated' },
            transaction,
        });

        if (!paymentTransaction) {
            await transaction.rollback();
            return res.status(404).json({ error: 'Payment transaction not found' });
        }

        await order.update({ status: 'failed' }, { transaction });
        await paymentTransaction.update({
            status: 'canceled',
            responseMessage: 'Payment canceled by user',
        }, { transaction });

        await notificationQueue.add({
            userId: user.id,
            title: 'Payment Canceled',
            message: `Your payment for order #${order.id} via PayPal was canceled.`,
            type: 'payment',
        });

        await transaction.commit();
        await redis.del(`paypal:${paymentTransaction.id}`);
        return res.redirect('/payment-cancel'); // Redirect to a cancel page (client-side)
    } catch (error) {
        await transaction.rollback();
        next(error);
    }
};

// Sắp xếp object theo alphabet
const sortObject = (obj) => {
    const sorted = {};
    Object.keys(obj).sort().forEach(key => {
        sorted[key] = obj[key];
    });
    return sorted;
};

module.exports = {
    initiatePayment,
    vnpayCallback,
    paypalCallback,
    paypalCancel,
    sortObject,
};