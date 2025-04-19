const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const PromotionCategory = sequelize.define('PromotionCategory', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    promotionId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'Promotions',
            key: 'id',
        },
    },
    categoryId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'Categories',
            key: 'id',
        },
    },
}, {
    tableName: 'PromotionCategories',
    timestamps: false,
});

module.exports = PromotionCategory;