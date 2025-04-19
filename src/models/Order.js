const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Order = sequelize.define('Order', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'Users',
            key: 'id',
        },
    },
    totalAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
    },
    status: {
        type: DataTypes.ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled'),
        defaultValue: 'pending',
    },
    addressId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'Addresses',
            key: 'id',
        },
    },
    paymentMethod: {
        type: DataTypes.ENUM('COD', 'VNPay', 'MOMO', 'VISA'),
        allowNull: false,
    },
    promotionId: {
        type: DataTypes.INTEGER,
        references: {
            model: 'Promotions',
            key: 'id',
        },
    },
    shippingFee: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0,
    },
    note: {
        type: DataTypes.TEXT,
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
    },
    updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
    },
}, {
    tableName: 'Orders',
    timestamps: true,
});

module.exports = Order;