const { initializeDatabase } = require('../config/database');
const { seedDatabase } = require('../seeders/seed');
const models = require('../models');

async function initDatabase(drop = false, seed = false) {
    try {
        // Khởi tạo database (xóa nếu drop = true)
        const sequelize = await initializeDatabase(drop);

        // Đồng bộ các bảng
        await sequelize.sync({ alter: true }); // alter: true để cập nhật schema nếu cần
        console.log('All tables synced successfully');

        // Seed dữ liệu nếu yêu cầu
        if (seed) {
            await seedDatabase();
            console.log('Database seeded successfully');
        }

        // Đóng kết nối
        await sequelize.close();
        console.log('Database initialization completed');
    } catch (error) {
        console.error('Error initializing database:', error);
        process.exit(1);
    }
}

// Xử lý tham số dòng lệnh
const shouldDrop = process.argv.includes('--drop');
const shouldSeed = process.argv.includes('--seed');
initDatabase(shouldDrop, shouldSeed);