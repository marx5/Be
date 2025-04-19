const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const CartItem = sequelize.define('CartItem', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    cartId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'Carts',
            key: 'id',
        },
    },
    productVariantId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'ProductVariants',
            key: 'id',
        },
    },
    quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
    },
    isSelected: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true, // Mặc định chọn khi thêm vào giỏ
    },
}, {
    tableName: 'CartItems',
    timestamps: true,
});

module.exports = CartItem;