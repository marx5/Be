const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ReviewReply = sequelize.define('ReviewReply', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    reviewId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'Reviews',
            key: 'id',
        },
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'Users',
            key: 'id',
        },
    },
    comment: {
        type: DataTypes.TEXT,
        allowNull: false,
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
    tableName: 'ReviewReplies',
    timestamps: true,
});

module.exports = ReviewReply;