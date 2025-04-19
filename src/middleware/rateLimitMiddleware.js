const rateLimit = require('express-rate-limit');

const rateLimitMiddleware = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 100, // Tối đa 100 yêu cầu mỗi 15 phút
    message: 'Too many requests from this IP, please try again later.',
    keyGenerator: (req) => req.user ? req.user.id : req.ip, // Giới hạn theo userId nếu đã đăng nhập, hoặc theo IP
});

module.exports = rateLimitMiddleware;