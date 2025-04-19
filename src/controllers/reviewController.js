const multer = require('multer');
const { body, query, validationResult } = require('express-validator');
const { Review, ReviewReply, ReviewLog, Order, OrderItem, Product, User, Notification } = require('../models');
const { Sequelize } = require('sequelize');
const { processImage, deleteProductImages } = require('../utils/imageProcessor');
const { notificationQueue } = require('../services/queue');
const redis = require('../config/redis');

// Cấu hình multer để upload hình ảnh đánh giá
const upload = multer({
    dest: 'uploads/temp/',
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(file.mimetype)) {
            return cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
        }
        cb(null, true);
    },
});

// Tính điểm trung bình và số lượng đánh giá cho sản phẩm
const updateProductRating = async (productId, transaction) => {
    const reviews = await Review.findAll({ where: { productId }, transaction });
    const ratingCount = reviews.length;
    const averageRating = ratingCount > 0 ? reviews.reduce((sum, review) => sum + review.rating, 0) / ratingCount : 0;

    await Product.update(
        { averageRating: averageRating.toFixed(1), ratingCount },
        { where: { id: productId }, transaction }
    );
};

// Thêm đánh giá
const addReview = [
    upload.array('images', 5), // Tối đa 5 hình ảnh
    body('productId').isInt().withMessage('Product ID must be an integer'),
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
    body('comment').optional().isString().withMessage('Comment must be a string'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { productId, rating, comment } = req.body;
        const files = req.files;
        const user = req.user;

        const transaction = await Sequelize.transaction();

        try {
            // Kiểm tra sản phẩm
            const product = await Product.findByPk(productId, { transaction });
            if (!product) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Product not found' });
            }

            // Kiểm tra trạng thái sản phẩm
            if (!product.isAvailable) {
                await transaction.rollback();
                return res.status(400).json({ error: 'Product is not available for review' });
            }

            // Kiểm tra xem người dùng đã mua sản phẩm chưa
            const hasPurchased = await Order.findOne({
                where: { userId: user.id, status: 'completed' },
                include: [
                    {
                        model: OrderItem,
                        as: 'OrderItems',
                        where: { productVariantId: Sequelize.literal(`(SELECT id FROM ProductVariants WHERE productId = ${productId})`) },
                    },
                ],
                transaction,
            });

            if (!hasPurchased) {
                await transaction.rollback();
                return res.status(403).json({ error: 'You can only review products you have purchased' });
            }

            // Kiểm tra thời gian đánh giá (30 ngày sau khi đơn hàng hoàn tất)
            const orderDate = new Date(hasPurchased.updatedAt);
            const now = new Date();
            const diffDays = (now - orderDate) / (1000 * 60 * 60 * 24);
            if (diffDays > 30) {
                await transaction.rollback();
                return res.status(400).json({ error: 'You can only review within 30 days of order completion' });
            }

            // Kiểm tra xem người dùng đã đánh giá sản phẩm này chưa
            const existingReview = await Review.findOne({
                where: { userId: user.id, productId },
                transaction,
            });
            if (existingReview) {
                await transaction.rollback();
                return res.status(400).json({ error: 'You have already reviewed this product' });
            }

            // Tạo đánh giá
            const review = await Review.create({
                userId: user.id,
                productId,
                rating,
                comment,
            }, { transaction });

            // Xử lý hình ảnh nếu có
            const imagePaths = [];
            if (files && files.length > 0) {
                for (let i = 0; i < files.length; i++) {
                    const { image, thumb } = await processImage(files[i], `review_${review.id}`, i);
                    imagePaths.push({ image, thumb });
                }
                await review.update({ images: imagePaths }, { transaction });
            }

            // Cập nhật điểm trung bình
            await updateProductRating(productId, transaction);

            await transaction.commit();

            // Gửi thông báo cho admin
            await notificationQueue.add({
                userId: user.id,
                title: 'New Review Submitted',
                message: `A new review for product #${productId} has been submitted by user #${user.id}.`,
                type: 'review',
            });

            // Xóa cache đánh giá của sản phẩm
            await redis.del(`reviews:${productId}`);

            return res.status(201).json({ message: 'Review added successfully', review });
        } catch (error) {
            await transaction.rollback();
            next(error);
        } finally {
            if (files && files.length > 0) {
                for (const file of files) {
                    await fs.unlink(file.path).catch(() => { });
                }
            }
        }
    },
];

// Trả lời đánh giá (admin)
const replyToReview = [
    body('reviewId').isInt().withMessage('Review ID must be an integer'),
    body('reply').isString().withMessage('Reply must be a string'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { reviewId, reply } = req.body;
        const user = req.user;

        const transaction = await Sequelize.transaction();

        try {
            if (user.role !== 'admin') {
                await transaction.rollback();
                return res.status(403).json({ error: 'Only admins can reply to reviews' });
            }

            const review = await Review.findByPk(reviewId, { transaction });
            if (!review) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Review not found' });
            }

            const reviewReply = await ReviewReply.create({
                reviewId,
                userId: user.id,
                reply,
            }, { transaction });

            await transaction.commit();

            // Gửi thông báo cho người dùng đã đánh giá
            await notificationQueue.add({
                userId: review.userId,
                title: 'Review Replied',
                message: `Your review for product #${review.productId} has received a reply from admin.`,
                type: 'review',
            });

            // Xóa cache đánh giá của sản phẩm
            await redis.del(`reviews:${review.productId}`);

            return res.status(201).json({ message: 'Reply added successfully', reviewReply });
        } catch (error) {
            await transaction.rollback();
            next(error);
        }
    },
];

// Sửa phản hồi đánh giá (admin)
const updateReviewReply = [
    body('replyId').isInt().withMessage('Reply ID must be an integer'),
    body('reply').isString().withMessage('Reply must be a string'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { replyId, reply } = req.body;
        const user = req.user;

        const transaction = await Sequelize.transaction();

        try {
            if (user.role !== 'admin') {
                await transaction.rollback();
                return res.status(403).json({ error: 'Only admins can update review replies' });
            }

            const reviewReply = await ReviewReply.findByPk(replyId, { transaction });
            if (!reviewReply) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Review reply not found' });
            }

            const review = await Review.findByPk(reviewReply.reviewId, { transaction });
            if (!review) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Review not found' });
            }

            await reviewReply.update({ reply }, { transaction });

            await transaction.commit();

            // Gửi thông báo cho người dùng đã đánh giá
            await notificationQueue.add({
                userId: review.userId,
                title: 'Review Reply Updated',
                message: `The reply to your review for product #${review.productId} has been updated by admin.`,
                type: 'review',
            });

            // Xóa cache đánh giá của sản phẩm
            await redis.del(`reviews:${review.productId}`);

            return res.status(200).json({ message: 'Review reply updated successfully', reviewReply });
        } catch (error) {
            await transaction.rollback();
            next(error);
        }
    },
];

// Các hàm khác giữ nguyên (getReviews, updateReview, deleteReview, deleteReviewReply, getAllReviews)
const getReviews = [
    query('productId').isInt().withMessage('Product ID must be an integer'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer'),
    query('rating').optional().isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
    query('hasImages').optional().isBoolean().withMessage('hasImages must be a boolean'),
    query('sortBy').optional().isIn(['newest', 'highest', 'lowest']).withMessage('sortBy must be newest, highest, or lowest'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { productId, page = 1, limit = 10, rating, hasImages, sortBy = 'newest' } = req.query;
        const offset = (page - 1) * limit;
        const cacheKey = `reviews:${productId}:page:${page}:limit:${limit}:rating:${rating || 'all'}:hasImages:${hasImages || 'all'}:sortBy:${sortBy}`;

        try {
            // Kiểm tra cache
            const cachedReviews = await redis.get(cacheKey);
            if (cachedReviews) {
                return res.status(200).json(JSON.parse(cachedReviews));
            }

            const where = { productId };
            if (rating) {
                where.rating = rating;
            }
            if (hasImages === 'true') {
                where.images = { [Sequelize.Op.ne]: [] };
            }

            let order;
            switch (sortBy) {
                case 'highest':
                    order = [['rating', 'DESC'], ['createdAt', 'DESC']];
                    break;
                case 'lowest':
                    order = [['rating', 'ASC'], ['createdAt', 'DESC']];
                    break;
                default:
                    order = [['createdAt', 'DESC']];
            }

            const { count, rows } = await Review.findAndCountAll({
                where,
                limit: parseInt(limit),
                offset,
                include: [
                    { model: User, as: 'User', attributes: ['id', 'fullName'] },
                    { model: ReviewReply, as: 'ReviewReplies', include: [{ model: User, as: 'User', attributes: ['id', 'fullName'] }] },
                ],
                order,
            });

            // Tính điểm trung bình và phân bố số sao
            const product = await Product.findByPk(productId);
            const ratingStats = await Review.findAll({
                where: { productId },
                attributes: [
                    'rating',
                    [Sequelize.fn('COUNT', Sequelize.col('rating')), 'count'],
                ],
                group: ['rating'],
            });

            const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
            ratingStats.forEach(stat => {
                const star = stat.rating;
                const percentage = (stat.get('count') / count) * 100 || 0;
                ratingDistribution[star] = percentage.toFixed(1);
            });

            const response = {
                reviews: rows,
                total: count,
                totalPages: Math.ceil(count / limit),
                currentPage: parseInt(page),
                averageRating: product.averageRating,
                ratingCount: product.ratingCount,
                ratingDistribution,
            };

            // Lưu vào cache
            await redis.setex(cacheKey, 3600, JSON.stringify(response));

            return res.status(200).json(response);
        } catch (error) {
            next(error);
        }
    },
];

const updateReview = [
    upload.array('images', 5),
    body('reviewId').isInt().withMessage('Review ID must be an integer'),
    body('rating').optional().isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
    body('comment').optional().isString().withMessage('Comment must be a string'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { reviewId, rating, comment } = req.body;
        const files = req.files;
        const user = req.user;

        const transaction = await Sequelize.transaction();

        try {
            const review = await Review.findByPk(reviewId, { transaction });
            if (!review) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Review not found' });
            }

            if (review.userId !== user.id) {
                await transaction.rollback();
                return res.status(403).json({ error: 'You can only edit your own reviews' });
            }

            // Kiểm tra thời gian chỉnh sửa (7 ngày)
            const reviewDate = new Date(review.createdAt);
            const now = new Date();
            const diffDays = (now - reviewDate) / (1000 * 60 * 60 * 24);
            if (diffDays > 7) {
                await transaction.rollback();
                return res.status(400).json({ error: 'You can only edit reviews within 7 days of creation' });
            }

            // Kiểm tra số lần chỉnh sửa (tối đa 3 lần)
            const editCount = await ReviewLog.count({
                where: { reviewId, action: 'edit' },
                transaction,
            });
            if (editCount >= 3) {
                await transaction.rollback();
                return res.status(400).json({ error: 'Maximum 3 edits allowed per review' });
            }

            // Kiểm tra số lượng hình ảnh
            const currentImageCount = review.images ? review.images.length : 0;
            const newImageCount = files ? files.length : 0;
            if (newImageCount > 0 && currentImageCount + newImageCount > 5) {
                await transaction.rollback();
                return res.status(400).json({ error: 'Maximum 5 images allowed per review' });
            }

            // Cập nhật đánh giá
            await review.update({
                rating: rating || review.rating,
                comment: comment || review.comment,
            }, { transaction });

            // Lưu lịch sử chỉnh sửa
            await ReviewLog.create({
                reviewId,
                userId: user.id,
                action: 'edit',
            }, { transaction });

            // Xử lý hình ảnh nếu có
            if (files && files.length > 0) {
                if (review.images && review.images.length > 0) {
                    await deleteProductImages(`review_${review.id}`);
                }

                const imagePaths = [];
                for (let i = 0; i < files.length; i++) {
                    const { image, thumb } = await processImage(files[i], `review_${review.id}`, i);
                    imagePaths.push({ image, thumb });
                }
                await review.update({ images: imagePaths }, { transaction });
            }

            // Cập nhật điểm trung bình
            await updateProductRating(review.productId, transaction);

            await transaction.commit();

            // Xóa cache đánh giá của sản phẩm
            await redis.del(`reviews:${review.productId}`);

            return res.status(200).json({ message: 'Review updated successfully', review });
        } catch (error) {
            await transaction.rollback();
            next(error);
        } finally {
            if (files && files.length > 0) {
                for (const file of files) {
                    await fs.unlink(file.path).catch(() => { });
                }
            }
        }
    },
];

const deleteReview = [
    body('reviewId').isInt().withMessage('Review ID must be an integer'),
    body('reason').optional().isString().withMessage('Reason must be a string'),
    async (req, res, next) => {
        const { reviewId, reason } = req.body;
        const user = req.user;

        const transaction = await Sequelize.transaction();

        try {
            const review = await Review.findByPk(reviewId, { transaction });
            if (!review) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Review not found' });
            }

            // Kiểm tra quyền xóa
            if (review.userId !== user.id && user.role !== 'admin') {
                await transaction.rollback();
                return res.status(403).json({ error: 'You can only delete your own reviews or you must be an admin' });
            }

            // Người dùng chỉ có thể xóa trong vòng 7 ngày
            if (review.userId === user.id) {
                const reviewDate = new Date(review.createdAt);
                const now = new Date();
                const diffDays = (now - reviewDate) / (1000 * 60 * 60 * 24);
                if (diffDays > 7) {
                    await transaction.rollback();
                    return res.status(400).json({ error: 'You can only delete reviews within 7 days of creation' });
                }
            }

            // Lưu lịch sử xóa nếu là admin
            if (user.role === 'admin') {
                await ReviewLog.create({
                    reviewId,
                    userId: user.id,
                    action: 'delete',
                    reason: reason || 'Deleted by admin',
                }, { transaction });
            }

            // Xóa hình ảnh nếu có
            if (review.images && review.images.length > 0) {
                await deleteProductImages(`review_${review.id}`);
            }

            // Xóa các phản hồi liên quan
            await ReviewReply.destroy({ where: { reviewId }, transaction });

            // Xóa đánh giá
            await review.destroy({ transaction });

            // Cập nhật điểm trung bình
            await updateProductRating(review.productId, transaction);

            await transaction.commit();

            // Xóa cache đánh giá của sản phẩm
            await redis.del(`reviews:${review.productId}`);

            return res.status(200).json({ message: 'Review deleted successfully' });
        } catch (error) {
            await transaction.rollback();
            next(error);
        }
    },
];

const deleteReviewReply = [
    body('replyId').isInt().withMessage('Reply ID must be an integer'),
    async (req, res, next) => {
        const { replyId } = req.body;
        const user = req.user;

        const transaction = await Sequelize.transaction();

        try {
            if (user.role !== 'admin') {
                await transaction.rollback();
                return res.status(403).json({ error: 'Only admins can delete review replies' });
            }

            const reviewReply = await ReviewReply.findByPk(replyId, { transaction });
            if (!reviewReply) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Review reply not found' });
            }

            const review = await Review.findByPk(reviewReply.reviewId, { transaction });
            if (!review) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Review not found' });
            }

            await reviewReply.destroy({ transaction });

            await transaction.commit();

            // Xóa cache đánh giá của sản phẩm
            await redis.del(`reviews:${review.productId}`);

            return res.status(200).json({ message: 'Review reply deleted successfully' });
        } catch (error) {
            await transaction.rollback();
            next(error);
        }
    },
];

const getAllReviews = [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer'),
    query('productId').optional().isInt().withMessage('Product ID must be an integer'),
    query('rating').optional().isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
    query('search').optional().isString().withMessage('Search must be a string'),
    async (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { page = 1, limit = 10, productId, rating, search } = req.query;
        const offset = (page - 1) * limit;
        const user = req.user;
        const cacheKey = `all_reviews:page:${page}:limit:${limit}:productId:${productId || 'all'}:rating:${rating || 'all'}:search:${search || 'none'}`;

        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Only admins can view all reviews' });
        }

        try {
            // Kiểm tra cache
            const cachedReviews = await redis.get(cacheKey);
            if (cachedReviews) {
                return res.status(200).json(JSON.parse(cachedReviews));
            }

            const where = {};
            if (productId) {
                where.productId = productId;
            }
            if (rating) {
                where.rating = rating;
            }
            if (search) {
                where[Sequelize.Op.or] = [
                    { comment: { [Sequelize.Op.like]: `%${search}%` } },
                    Sequelize.literal(`EXISTS (SELECT 1 FROM Users WHERE Users.id = Review.userId AND Users.fullName LIKE '%${search}%')`),
                ];
            }

            const { count, rows } = await Review.findAndCountAll({
                where,
                limit: parseInt(limit),
                offset,
                include: [
                    { model: User, as: 'User', attributes: ['id', 'fullName'] },
                    { model: Product, as: 'Product', attributes: ['id', 'name'] },
                    { model: ReviewReply, as: 'ReviewReplies', include: [{ model: User, as: 'User', attributes: ['id', 'fullName'] }] },
                ],
                order: [['createdAt', 'DESC']],
            });

            const response = {
                reviews: rows,
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
    addReview,
    getReviews,
    updateReview,
    deleteReview,
    replyToReview,
    updateReviewReply,
    deleteReviewReply,
    getAllReviews,
    upload,
};