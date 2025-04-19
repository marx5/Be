const { Sequelize } = require('sequelize');
require('dotenv').config();

// Khởi tạo database tạm thời để kiểm tra/tạo database
async function initializeDatabase(drop = false) {
    const tempSequelize = new Sequelize('', process.env.DB_USER, process.env.DB_PASS, {
        host: process.env.DB_HOST,
        dialect: 'mysql',
        logging: false,
    });

    try {
        if (drop) {
            await tempSequelize.query(`DROP DATABASE IF EXISTS ${process.env.DB_NAME}`);
            console.log(`Database ${process.env.DB_NAME} dropped`);
        }

        const [results] = await tempSequelize.query(
            `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${process.env.DB_NAME}'`
        );

        if (results.length === 0) {
            await tempSequelize.query(`CREATE DATABASE ${process.env.DB_NAME}`);
            console.log(`Database ${process.env.DB_NAME} created successfully`);
        } else {
            console.log(`Database ${process.env.DB_NAME} already exists`);
        }
    } catch (error) {
        console.error('Error checking/creating database:', error);
        throw error;
    } finally {
        await tempSequelize.close();
    }
}

// Khởi tạo sequelize instance
const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    {
        host: process.env.DB_HOST,
        dialect: 'mysql',
        logging: false,
    }
);

module.exports = { sequelize, initializeDatabase };