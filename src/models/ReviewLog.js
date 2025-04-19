const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ReviewLog = sequelize.define('ReviewLog', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    reviewId: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'Users',
            key: 'id',
        },
    },
    action: {
        type: DataTypes.ENUM('delete'),
        allowNull: false,
    },
    reason: {
        type: DataTypes.STRING,
        allowNull: true,
    },
}, {
    tableName: 'ReviewLogs',
    timestamps: true,
});

module.exports = ReviewLog;