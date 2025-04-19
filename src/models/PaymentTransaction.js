const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const PaymentTransaction = sequelize.define('PaymentTransaction', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    orderId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'Orders',
            key: 'id',
        },
    },
    paymentMethod: {
        type: DataTypes.ENUM('COD', 'VNPay', 'PayPal'),
        allowNull: false,
    },
    transactionId: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    status: {
        type: DataTypes.ENUM('initiated', 'completed', 'failed', 'canceled'),
        allowNull: false,
        defaultValue: 'initiated',
    },
    amount: {
        type: DataTypes.FLOAT,
        allowNull: false,
    },
    currency: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'VND',
    },
    responseCode: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    responseMessage: {
        type: DataTypes.STRING,
        allowNull: true,
    },
}, {
    tableName: 'PaymentTransactions',
    timestamps: true,
});

module.exports = PaymentTransaction;