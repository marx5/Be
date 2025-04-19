const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const UserView = sequelize.define('UserView', {
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
    productId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'Products',
            key: 'id',
        },
    },
}, {
    tableName: 'UserViews',
    timestamps: true,
});

module.exports = UserView;