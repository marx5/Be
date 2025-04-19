const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { sequelize, initializeDatabase } = require('../src/config/database');
const { seedDatabase } = require('../src/seeders/seed');
const models = require('../src/models'); // Import tất cả các model
const loggingMiddleware = require('../src/middleware/loggingMiddleware');
const errorMiddleware = require('../src/middleware/errorMiddleware');
const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

// Load biến môi trường từ .env
dotenv.config();

// Khởi tạo ứng dụng Express
const app = express();

// Swagger configuration
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Fashion Store API',
            version: '1.0.0',
            description: 'API Documentation for Fashion Store Backend',
            contact: {
                name: 'API Support',
                email: 'support@fashionstore.com'
            }
        },
        servers: [
            {
                url: 'http://localhost:5000',
                description: 'Development Server'
            }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT'
                }
            }
        },
        security: [
            {
                bearerAuth: []
            }
        ]
    },
    apis: ['./src/routes/*.js', './src/swagger/*.js']
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));


// Middleware
app.use(cors()); // Cho phép CORS
app.use(express.json()); // Parse JSON body
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded body
app.use('/uploads', express.static('uploads')); // Phục vụ file tĩnh từ thư mục uploads
app.use('/images', express.static('images')); // Phục vụ file ảnh từ thư mục images
app.use('/public', express.static('public')); // Phục vụ file tĩnh từ thư mục public

app.use(loggingMiddleware); // Ghi log các yêu cầu

// Tùy chọn xóa database (có thể cấu hình qua .env hoặc trực tiếp)
const DROP_DATABASE = false; // Mặc định false
const SEED_DATA = false; // Tùy chọn seed dữ liệu mẫu

// Khởi tạo và kết nối database
async function startServer() {
    try {
        // Khởi tạo database (xóa nếu DROP_DATABASE = true)
        await initializeDatabase(DROP_DATABASE);

        // Kiểm tra kết nối
        await sequelize.authenticate();
        console.log('Database connected successfully');

        // Đồng bộ các bảng (không xóa dữ liệu nếu DROP_DATABASE = false)
        await sequelize.sync({ alter: true });
        console.log('All tables synced successfully');

        // Seed dữ liệu nếu yêu cầu
        if (SEED_DATA) {
            await seedDatabase();
            console.log('Database seeded successfully');
        }

        // Đăng ký routes
        const authRoutes = require('../src/routes/authRoutes');
        const userRoutes = require('../src/routes/userRoutes');
        const productRoutes = require('../src/routes/productRoutes');
        const cartRoutes = require('../src/routes/cartRoutes');
        const orderRoutes = require('../src/routes/orderRoutes');
        const categoryRoutes = require('../src/routes/categoryRoutes');
        const paymentRoutes = require('../src/routes/paymentRoutes');
        const reviewRoutes = require('../src/routes/reviewRoutes');
        const wishlistRoutes = require('../src/routes/wishlistRoutes');
        const notificationRoutes = require('../src/routes/notificationRoutes');
        const promotionRoutes = require('../src/routes/promotionRoutes');
        const searchRoutes = require('../src/routes/searchRoutes');
        const recommendationRoutes = require('../src/routes/recommendationRoutes');

        app.use('/api/auth', authRoutes);
        app.use('/api/users', userRoutes);
        app.use('/api/products', productRoutes);
        app.use('/api/cart', cartRoutes);
        app.use('/api/orders', orderRoutes);
        app.use('/api/categories', categoryRoutes);
        app.use('/api/payments', paymentRoutes);
        app.use('/api/reviews', reviewRoutes);
        app.use('/api/wishlist', wishlistRoutes);
        app.use('/api/notifications', notificationRoutes);
        app.use('/api/promotions', promotionRoutes);
        app.use('/api/search', searchRoutes);
        app.use('/api/recommendations', recommendationRoutes);
        // Đăng ký các route khác (nếu có)


        // Route cơ bản để kiểm tra server
        app.get('/', (req, res) => {
            res.json({ message: "Welcome to Fashion Store's Backend" });
        });

        app.use(errorMiddleware); // Middleware xử lý lỗi

        // Khởi động server
        const PORT = process.env.PORT || 5000;
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Error starting server:', error);
        process.exit(1);
    }
}

// Chạy server
startServer();
