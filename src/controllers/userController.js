const { body, validationResult } = require('express-validator');
const { User, Address, RefreshToken } = require('../models');
const { Sequelize } = require('sequelize');

// Lấy thông tin cá nhân
const getProfile = async (req, res) => {
    try {
        const user = req.user;
        const addresses = await Address.findAll({ where: { userId: user.id } });
        res.status(200).json({
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            phone: user.phone,
            role: user.role,
            addresses,
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

// Cập nhật thông tin cá nhân
const updateProfile = [
    body('fullName').notEmpty().withMessage('Full name is required'),
    body('phone').optional().matches(/^[0-9]{10,15}$/).withMessage('Invalid phone number'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { fullName, phone } = req.body;

        try {
            const user = req.user;
            await user.update({ fullName, phone });

            res.status(200).json({
                message: 'Profile updated successfully',
                user: { id: user.id, email: user.email, fullName: user.fullName, phone: user.phone },
            });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    },
];

// Thêm địa chỉ
const addAddress = [
    body('address').notEmpty().withMessage('Address is required'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { address, isDefault } = req.body;

        try {
            const user = req.user;

            // Giới hạn số lượng địa chỉ tối đa (VD: 10)
            const addressCount = await Address.count({ where: { userId: user.id } });
            if (addressCount >= 10) {
                return res.status(400).json({ error: 'Maximum address limit reached (10)' });
            }

            if (isDefault) {
                await Address.update({ isDefault: false }, { where: { userId: user.id } });
            }

            const newAddress = await Address.create({
                userId: user.id,
                address,
                isDefault: isDefault || false,
            });

            const addresses = await Address.findAll({ where: { userId: user.id } });
            res.status(201).json({ message: 'Address added successfully', addresses });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    },
];

// Lấy danh sách địa chỉ
const getAddresses = async (req, res) => {
    try {
        const user = req.user;
        const addresses = await Address.findAll({ where: { userId: user.id } });
        res.status(200).json({ addresses });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

// Cập nhật địa chỉ
const updateAddress = [
    body('address').notEmpty().withMessage('Address is required'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { address, isDefault } = req.body;
        const { id } = req.params;

        try {
            const user = req.user;
            const addressRecord = await Address.findOne({ where: { id, userId: user.id } });
            if (!addressRecord) {
                return res.status(404).json({ error: 'Address not found' });
            }

            if (isDefault) {
                await Address.update({ isDefault: false }, { where: { userId: user.id } });
            }

            await addressRecord.update({ address, isDefault: isDefault || false });

            const addresses = await Address.findAll({ where: { userId: user.id } });
            res.status(200).json({ message: 'Address updated successfully', addresses });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    },
];

// Xóa địa chỉ
const deleteAddress = async (req, res) => {
    const { id } = req.params;

    try {
        const user = req.user;
        const address = await Address.findOne({ where: { id, userId: user.id } });
        if (!address) {
            return res.status(404).json({ error: 'Address not found' });
        }

        await address.destroy();

        const addresses = await Address.findAll({ where: { userId: user.id } });
        res.status(200).json({ message: 'Address deleted successfully', addresses });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

// Admin: Lấy danh sách người dùng
const getUsers = async (req, res) => {
    try {
        const { page = 1, limit = 10, search } = req.query;
        const offset = (page - 1) * limit;

        const where = {};
        if (search) {
            where[Sequelize.Op.or] = [
                { email: { [Sequelize.Op.like]: `%${search}%` } },
                { fullName: { [Sequelize.Op.like]: `%${search}%` } },
                { phone: { [Sequelize.Op.like]: `%${search}%` } },
                { role: { [Sequelize.Op.like]: `%${search}%` } },
            ];
        }

        const { count, rows } = await User.findAndCountAll({
            where,
            limit: parseInt(limit),
            offset,
            attributes: ['id', 'email', 'fullName', 'phone', 'role', 'createdAt'],
        });

        res.status(200).json({
            users: rows,
            total: count,
            totalPages: Math.ceil(count / limit),
            currentPage: parseInt(page),
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

// Admin: Lấy chi tiết người dùng
const getUserById = async (req, res) => {
    const { id } = req.params;

    try {
        const user = await User.findByPk(id, {
            attributes: ['id', 'email', 'fullName', 'phone', 'role', 'createdAt'],
            include: [{ model: Address, as: 'Addresses' }],
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.status(200).json({ user });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

// Admin: Cập nhật thông tin người dùng
const updateUser = [
    body('fullName').optional().notEmpty().withMessage('Full name cannot be empty'),
    body('phone').optional().matches(/^[0-9]{10,15}$/).withMessage('Invalid phone number'),
    body('role').optional().isIn(['user', 'admin']).withMessage('Invalid role'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { id } = req.params;
        const { fullName, phone, role } = req.body;

        try {
            const user = await User.findByPk(id);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Ngăn admin thay đổi role của chính mình
            if (user.id === req.user.id && role !== req.user.role) {
                return res.status(400).json({ error: 'Cannot change your own role' });
            }

            await user.update({ fullName, phone, role });

            res.status(200).json({
                message: 'User updated successfully',
                user: { id: user.id, email: user.email, fullName: user.fullName, phone: user.phone, role: user.role },
            });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    },
];

// Admin: Xóa người dùng
const deleteUser = async (req, res) => {
    const { id } = req.params;

    try {
        const user = await User.findByPk(id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Không cho phép admin tự xóa chính mình
        if (user.id === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }

        // Xóa các dữ liệu liên quan
        await Address.destroy({ where: { userId: id } });
        await RefreshToken.destroy({ where: { userId: id } });
        // Note: Có thể cần xóa thêm dữ liệu từ các bảng khác (Orders, Reviews, v.v.)

        await user.destroy();

        res.status(200).json({ message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = {
    getProfile,
    updateProfile,
    addAddress,
    getAddresses,
    updateAddress,
    deleteAddress,
    getUsers,
    getUserById,
    updateUser,
    deleteUser,
};