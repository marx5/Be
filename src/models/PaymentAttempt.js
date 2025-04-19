const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const PaymentAttempt = sequelize.define('PaymentAttempt', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    paymentId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'Payments',
            key: 'id',
        },
    },
    transactionId: {
        type: DataTypes.STRING(100),
    },
    status: {
        type: DataTypes.ENUM('pending', 'completed', 'failed'),
        defaultValue: 'pending',
    },
    details: {
        type: DataTypes.JSON,
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
    },
}, {
    tableName: 'PaymentAttempts',
    timestamps: true,
    updatedAt: false,
});

module.exports = PaymentAttempt;