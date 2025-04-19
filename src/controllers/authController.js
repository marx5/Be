const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const axios = require('axios');
const { User, PasswordReset, RefreshToken } = require('../models');

// Validate reCAPTCHA
const verifyRecaptcha = async (recaptchaResponse) => {
    const response = await axios.post('https://www.google.com/recaptcha/api/siteverify', null, {
        params: {
            secret: process.env.RECAPTCHA_SECRET_KEY,
            response: recaptchaResponse,
        },
    });
    return response.data.success;
};

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// Đăng ký
const register = [
    body('email').isEmail().withMessage('Invalid email'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('fullName').notEmpty().withMessage('Full name is required'),
    body('phone').optional().matches(/^[0-9]{10,15}$/).withMessage('Invalid phone number'),
    body('gRecaptchaResponse').isString().withMessage('reCAPTCHA token is required'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password, fullName, phone, gRecaptchaResponse } = req.body;

        try {
            // Bỏ qua kiểm tra reCAPTCHA trong môi trường test
            if (process.env.NODE_ENV !== 'test') {
                const recaptchaValid = await verifyRecaptcha(gRecaptchaResponse);
                if (!recaptchaValid) {
                    return res.status(400).json({ error: 'Bot verification failed' });
                }
            }

            // Check if email exists
            const existingUser = await User.findOne({ where: { email } });
            if (existingUser) {
                return res.status(400).json({ error: 'Email already in use' });
            }

            // Hash password
            const hashedPassword = await bcrypt.hash(password, 10);

            // Create user
            const user = await User.create({
                email,
                password: hashedPassword,
                fullName,
                phone,
                role: 'user',
            });

            // Create default cart
            await user.createCart();

            // Send confirmation email
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: 'Welcome to Fashion Store',
                html: `<p>Hi ${fullName},</p>
               <p>Thank you for registering at Fashion Store. Your account is now active!</p>`,
            };
            await transporter.sendMail(mailOptions);

            res.status(201).json({
                message: 'User registered successfully',
                user: { id: user.id, email: user.email, fullName: user.fullName, phone: user.phone },
            });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    },
];

// Đăng nhập (Admin hoặc User)
const login = [
    body('email').isEmail().withMessage('Invalid email'),
    body('password').notEmpty().withMessage('Password is required'),
    body('gRecaptchaResponse').isString().withMessage('reCAPTCHA token is required'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password, gRecaptchaResponse, rememberMe } = req.body;

        try {
            // Bỏ qua kiểm tra reCAPTCHA trong môi trường test
            if (process.env.NODE_ENV !== 'test') {
                const recaptchaValid = await verifyRecaptcha(gRecaptchaResponse);
                if (!recaptchaValid) {
                    return res.status(400).json({ error: 'Bot verification failed' });
                }
            }

            // Find user
            const user = await User.findOne({ where: { email } });
            if (!user) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            // Check if account is active (assuming isActive field exists)
            // if (!user.isActive) {
            //     return res.status(403).json({ error: 'Account is disabled' });
            // }

            // Check password
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            // Create Access Token
            const accessToken = jwt.sign(
                { id: user.id, email: user.email, role: user.role, type: 'access' },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN }
            );

            // Create Refresh Token if "Remember Me" is selected
            let refreshToken = null;
            if (rememberMe) {
                const refreshTokenValue = crypto.randomBytes(32).toString('hex');
                const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
                refreshToken = await RefreshToken.create({
                    userId: user.id,
                    token: refreshTokenValue,
                    expiresAt,
                });
            }

            res.status(200).json({
                message: 'Login successful',
                accessToken,
                refreshToken: refreshToken ? refreshToken.token : null,
                user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
            });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    },
];

// Quên mật khẩu
const forgotPassword = [
    body('email').isEmail().withMessage('Invalid email'),
    body('gRecaptchaResponse').isString().withMessage('reCAPTCHA token is required'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, gRecaptchaResponse } = req.body;

        try {
            // Bỏ qua kiểm tra reCAPTCHA trong môi trường test
            if (process.env.NODE_ENV !== 'test') {
                const recaptchaValid = await verifyRecaptcha(gRecaptchaResponse);
                if (!recaptchaValid) {
                    return res.status(400).json({ error: 'Bot verification failed' });
                }
            }

            // Find user
            const user = await User.findOne({ where: { email } });
            if (!user) {
                return res.status(404).json({ error: 'Email not found' });
            }

            // Create reset token
            const token = crypto.randomBytes(20).toString('hex');
            const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

            await PasswordReset.create({
                userId: user.id,
                token,
                expiresAt,
            });

            // Send email
            const resetLink = `http://localhost:5000/reset-password?token=${token}`;
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: 'Password Reset Request',
                html: `<p>You requested a password reset. Click the link below to reset your password:</p>
               <a href="${resetLink}">${resetLink}</a>
               <p>This link will expire in 1 hour.</p>`,
            };

            await transporter.sendMail(mailOptions);

            res.status(200).json({ message: 'Reset link sent to your email' });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    },
];

// Đặt lại mật khẩu
const resetPassword = [
    body('token').notEmpty().withMessage('Token is required'),
    body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { token, newPassword } = req.body;

        try {
            // Find reset token
            const reset = await PasswordReset.findOne({ where: { token } });
            if (!reset || reset.expiresAt < new Date()) {
                return res.status(400).json({ error: 'Invalid or expired token' });
            }

            // Find user
            const user = await User.findByPk(reset.userId);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Update password
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            await user.update({ password: hashedPassword });

            // Delete reset token
            await reset.destroy();

            // Send confirmation email
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: user.email,
                subject: 'Password Reset Successful',
                html: `<p>Hi ${user.fullName},</p>
               <p>Your password has been successfully reset. If you did not perform this action, please contact support.</p>`,
            };
            await transporter.sendMail(mailOptions);

            res.status(200).json({ message: 'Password reset successfully' });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    },
];

// Làm mới token
const refreshToken = async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(400).json({ error: 'Refresh token is required' });
    }

    try {
        // Find refresh token
        const tokenRecord = await RefreshToken.findOne({ where: { token: refreshToken } });
        if (!tokenRecord || tokenRecord.isRevoked || tokenRecord.expiresAt < new Date()) {
            return res.status(401).json({ error: 'Invalid or expired refresh token' });
        }

        // Find user
        const user = await User.findByPk(tokenRecord.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Create new Access Token
        const accessToken = jwt.sign(
            { id: user.id, email: user.email, role: user.role, type: 'access' },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN }
        );

        // Create new Refresh Token and revoke old one
        await tokenRecord.update({ isRevoked: true });
        const newRefreshTokenValue = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
        const newRefreshToken = await RefreshToken.create({
            userId: user.id,
            token: newRefreshTokenValue,
            expiresAt,
        });

        res.status(200).json({ accessToken, refreshToken: newRefreshToken.token });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

// Đăng xuất
const logout = async (req, res) => {
    const { refreshToken } = req.body;

    try {
        // If refresh token is provided, revoke it
        if (refreshToken) {
            const tokenRecord = await RefreshToken.findOne({ where: { token: refreshToken, userId: req.user.id } });
            if (tokenRecord) {
                await tokenRecord.update({ isRevoked: true });
            }
        }

        res.status(200).json({ message: 'Logged out successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = {
    register,
    login,
    forgotPassword,
    resetPassword,
    refreshToken,
    logout,
};