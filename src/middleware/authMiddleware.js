const jwt = require('jsonwebtoken');
const { User } = require('../models');

const authMiddleware = (requiredRole = null) => async (req, res, next) => {
    try {
        // Lấy token từ header
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ error: 'Vui lòng đăng nhập' });
        }

        // Xác thực token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Kiểm tra token có phải là Access Token
        if (decoded.type !== 'access') {
            return res.status(401).json({ error: 'Đăng nhập không hợp lệ' });
        }

        // Tìm người dùng
        const user = await User.findByPk(decoded.id);
        if (!user) {
            return res.status(401).json({ error: 'Người dùng không tồn tại' });
        }

        // Kiểm tra quyền truy cập (nếu có)
        if (requiredRole && user.role !== requiredRole) {
            return res.status(403).json({ error: 'Quyền truy cập bị từ chối' });
        }

        // Gắn user vào request
        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        return res.status(401).json({ error: 'Invalid token' });
    }
};

module.exports = authMiddleware;