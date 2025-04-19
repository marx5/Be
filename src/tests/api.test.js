const request = require('supertest');
const app = require('../server');
const { sequelize } = require('../src/config/database');
const { initializeDatabase } = require('../src/config/database');
const { seedDatabase } = require('../src/seeders/seed');

describe('Ecommerce API', () => {
    let userToken;
    let adminToken;
    let userRefreshToken;
    let adminRefreshToken;
    let resetToken;
    let categoryId;
    let productId;
    let productVariantId;
    let cartItemId;
    let addressId;
    let orderId;
    let paymentTransactionId;
    let reviewId;
    let wishlistItemId;
    let notificationId;
    let promotionId;

    // Thiết lập dữ liệu trước khi chạy test
    beforeAll(async () => {
        // Khởi tạo database và seed dữ liệu
        await initializeDatabase(true); // Xóa database trước khi test
        await sequelize.sync({ force: true });
        await seedDatabase();

        // Đăng ký và đăng nhập người dùng thường
        await request(app)
            .post('/api/auth/register')
            .send({
                fullName: 'Test User',
                email: 'user@example.com',
                password: 'password123',
                phone: '1234567890',
                gRecaptchaResponse: 'test-token', // Token giả cho môi trường test
            });

        const userLogin = await request(app)
            .post('/api/auth/login')
            .send({
                email: 'user@example.com',
                password: 'password123',
                gRecaptchaResponse: 'test-token',
                rememberMe: true,
            });
        userToken = userLogin.body.accessToken;
        userRefreshToken = userLogin.body.refreshToken;

        // Đăng ký và đăng nhập admin
        await request(app)
            .post('/api/auth/register')
            .send({
                fullName: 'Admin User',
                email: 'admin@example.com',
                password: 'password123',
                phone: '0987654321',
                role: 'admin',
                gRecaptchaResponse: 'test-token',
            });

        const adminLogin = await request(app)
            .post('/api/auth/login')
            .send({
                email: 'admin@example.com',
                password: 'password123',
                gRecaptchaResponse: 'test-token',
                rememberMe: true,
            });
        adminToken = adminLogin.body.accessToken;
        adminRefreshToken = adminLogin.body.refreshToken;

        // Tạo địa chỉ cho người dùng
        const addressRes = await request(app)
            .post('/api/users/addresses')
            .set('Authorization', `Bearer ${userToken}`)
            .send({
                address: '123 Test Street',
                city: 'Test City',
                country: 'Test Country',
                postalCode: '12345',
            });
        addressId = addressRes.body.address.id;
    });

    // Dọn dẹp sau khi chạy test
    afterAll(async () => {
        await sequelize.close();
    });

    // Test Auth
    describe('Auth', () => {
        it('should register a new user', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    fullName: 'New User',
                    email: 'newuser@example.com',
                    password: 'password123',
                    phone: '1234567890',
                    gRecaptchaResponse: 'test-token',
                });
            expect(res.statusCode).toBe(201);
            expect(res.body).toHaveProperty('user');
        });

        it('should fail to register with existing email', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({
                    fullName: 'Duplicate User',
                    email: 'user@example.com',
                    password: 'password123',
                    phone: '1234567890',
                    gRecaptchaResponse: 'test-token',
                });
            expect(res.statusCode).toBe(400);
            expect(res.body).toHaveProperty('error', 'Email already in use');
        });

        it('should login user', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'user@example.com',
                    password: 'password123',
                    gRecaptchaResponse: 'test-token',
                    rememberMe: false,
                });
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('accessToken');
        });

        it('should fail to login with wrong password', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'user@example.com',
                    password: 'wrongpassword',
                    gRecaptchaResponse: 'test-token',
                });
            expect(res.statusCode).toBe(401);
            expect(res.body).toHaveProperty('error', 'Invalid credentials');
        });

        it('should request password reset', async () => {
            const res = await request(app)
                .post('/api/auth/forgot-password')
                .send({
                    email: 'user@example.com',
                    gRecaptchaResponse: 'test-token',
                });
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('message', 'Reset link sent to your email');

            // Lấy reset token từ database để dùng trong test reset password
            const reset = await PasswordReset.findOne({ where: { userId: 1 } }); // Giả sử userId=1
            resetToken = reset.token;
        });

        it('should reset password', async () => {
            const res = await request(app)
                .post('/api/auth/reset-password')
                .send({
                    token: resetToken,
                    newPassword: 'newpassword123',
                });
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('message', 'Password reset successfully');
        });

        it('should refresh token', async () => {
            const res = await request(app)
                .post('/api/auth/refresh-token')
                .send({
                    refreshToken: userRefreshToken,
                });
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('accessToken');
            expect(res.body).toHaveProperty('refreshToken');
        });

        it('should logout user', async () => {
            const res = await request(app)
                .post('/api/auth/logout')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    refreshToken: userRefreshToken,
                });
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('message', 'Logged out successfully');
        });
    });

    // Test User
    describe('User', () => {
        it('should update user information', async () => {
            const res = await request(app)
                .put('/api/users')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    fullName: 'Updated User',
                    phone: '0987654321',
                });
            expect(res.statusCode).toBe(200);
            expect(res.body.user.fullName).toBe('Updated User');
        });

        it('should change user password', async () => {
            const res = await request(app)
                .put('/api/users/change-password')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    oldPassword: 'newpassword123', // Password đã được reset ở bước trước
                    newPassword: 'password123',
                });
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('message', 'Password changed successfully');
        });

        it('should fail to change password with wrong old password', async () => {
            const res = await request(app)
                .put('/api/users/change-password')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    oldPassword: 'wrongpassword',
                    newPassword: 'newpassword123',
                });
            expect(res.statusCode).toBe(400);
            expect(res.body).toHaveProperty('error', 'Old password is incorrect');
        });
    });

    // Test Category
    describe('Category', () => {
        it('should create a new category (admin)', async () => {
            const res = await request(app)
                .post('/api/categories')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    name: 'Clothing',
                    description: 'Clothing category',
                });
            expect(res.statusCode).toBe(201);
            expect(res.body).toHaveProperty('category');
            categoryId = res.body.category.id;
        });

        it('should fail to create category without admin role', async () => {
            const res = await request(app)
                .post('/api/categories')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    name: 'Electronics',
                    description: 'Electronics category',
                });
            expect(res.statusCode).toBe(403);
            expect(res.body).toHaveProperty('error', 'Admin access required');
        });

        it('should get list of categories', async () => {
            const res = await request(app)
                .get('/api/categories?page=1&limit=10');
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('categories');
        });
    });

    // Test Product
    describe('Product', () => {
        it('should create a new product (admin)', async () => {
            const res = await request(app)
                .post('/api/products')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    name: 'T-Shirt',
                    description: 'A comfy T-shirt',
                    price: 200000,
                    categoryId,
                    stock: 100,
                    material: 'Cotton',
                    brand: 'Nike',
                    variants: [
                        { color: 'Blue', size: 'M', stock: 50 },
                        { color: 'Red', size: 'L', stock: 50 },
                    ],
                });
            expect(res.statusCode).toBe(201);
            expect(res.body).toHaveProperty('product');
            productId = res.body.product.id;
            productVariantId = res.body.product.ProductVariants[0].id;
        });

        it('should get list of products', async () => {
            const res = await request(app)
                .get(`/api/products?page=1&limit=10&categoryId=${categoryId}`);
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('products');
        });

        it('should get product by ID', async () => {
            const res = await request(app)
                .get(`/api/products/${productId}`)
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('product');
        });
    });

    // Test Cart
    describe('Cart', () => {
        it('should add item to cart', async () => {
            const res = await request(app)
                .post('/api/cart')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    productVariantId,
                    quantity: 2,
                });
            expect(res.statusCode).toBe(201);
            expect(res.body).toHaveProperty('cart');
            cartItemId = res.body.cart.CartItems[0].id;
        });

        it('should fail to add item with insufficient stock', async () => {
            const res = await request(app)
                .post('/api/cart')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    productVariantId,
                    quantity: 1000,
                });
            expect(res.statusCode).toBe(400);
            expect(res.body).toHaveProperty('error', 'Insufficient stock');
        });

        it('should get cart', async () => {
            const res = await request(app)
                .get('/api/cart')
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('cart');
        });
    });

    // Test Order
    describe('Order', () => {
        it('should create order from cart', async () => {
            const res = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    selectAll: true,
                    addressId,
                    paymentMethod: 'COD',
                });
            expect(res.statusCode).toBe(201);
            expect(res.body).toHaveProperty('order');
            orderId = res.body.order.id;
        });

        it('should cancel order', async () => {
            const res = await request(app)
                .put(`/api/orders/cancel/${orderId}`)
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('message', 'Order canceled successfully');
        });

        it('should get list of orders', async () => {
            const res = await request(app)
                .get('/api/orders?page=1&limit=10')
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('orders');
        });
    });

    // Test Payment
    describe('Payment', () => {
        // Tạo lại một đơn hàng để kiểm tra thanh toán
        beforeAll(async () => {
            const orderRes = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    selectAll: true,
                    addressId,
                    paymentMethod: 'COD',
                });
            orderId = orderRes.body.order.id;
        });

        it('should initiate COD payment', async () => {
            const res = await request(app)
                .post('/api/payments/initiate')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    orderId,
                });
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('message', 'COD payment initiated successfully');
        });
    });

    // Test Review
    describe('Review', () => {
        it('should add a review', async () => {
            const res = await request(app)
                .post('/api/reviews')
                .set('Authorization', `Bearer ${userToken}`)
                .field('productId', productId)
                .field('rating', 5)
                .field('comment', 'Great product!');
            expect(res.statusCode).toBe(201);
            expect(res.body).toHaveProperty('review');
            reviewId = res.body.review.id;
        });

        it('should get reviews for a product', async () => {
            const res = await request(app)
                .get(`/api/reviews?productId=${productId}`);
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('reviews');
        });
    });

    // Test Wishlist
    describe('Wishlist', () => {
        it('should add product to wishlist', async () => {
            const res = await request(app)
                .post('/api/wishlist')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    productId,
                });
            expect(res.statusCode).toBe(201);
            expect(res.body).toHaveProperty('message', 'Product added to wishlist successfully');
        });

        it('should get wishlist', async () => {
            const res = await request(app)
                .get('/api/wishlist?page=1&limit=10')
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('wishlist');
            wishlistItemId = res.body.wishlist[0].id;
        });
    });

    // Test Notification
    describe('Notification', () => {
        it('should get notifications', async () => {
            const res = await request(app)
                .get('/api/notifications?page=1&limit=10')
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('notifications');
            notificationId = res.body.notifications[0]?.id;
        });

        if (notificationId) {
            it('should mark notification as read', async () => {
                const res = await request(app)
                    .put('/api/notifications/mark-as-read')
                    .set('Authorization', `Bearer ${userToken}`)
                    .send({
                        notificationIds: [notificationId],
                    });
                expect(res.statusCode).toBe(200);
                expect(res.body).toHaveProperty('message', 'Notifications marked as read');
            });
        }
    });

    // Test Promotion
    describe('Promotion', () => {
        it('should create a promotion (admin)', async () => {
            const res = await request(app)
                .post('/api/promotions')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    code: 'TEST10',
                    discountType: 'percentage',
                    discount: 10,
                    minOrderValue: 500000,
                    startDate: '2025-04-20T00:00:00Z',
                    endDate: '2025-04-30T23:59:59Z',
                    maxUses: 100,
                });
            expect(res.statusCode).toBe(201);
            expect(res.body).toHaveProperty('promotion');
            promotionId = res.body.promotion.id;
        });

        it('should get available promotions', async () => {
            const res = await request(app)
                .get('/api/promotions?page=1&limit=10')
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('availablePromotions');
        });
    });

    // Test Search
    describe('Search', () => {
        it('should search products by keyword', async () => {
            const res = await request(app)
                .get('/api/search?keyword=T-Shirt&minPrice=100000&maxPrice=500000');
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('products');
        });

        it('should provide autocomplete suggestions', async () => {
            const res = await request(app)
                .get('/api/search/autocomplete?keyword=T-Sh');
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('suggestions');
        });
    });

    // Test Recommendation
    describe('Recommendation', () => {
        it('should get personalized recommendations', async () => {
            const res = await request(app)
                .get('/api/recommendations/personalized?limit=5')
                .set('Authorization', `Bearer ${userToken}`);
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('products');
        });

        it('should get related products', async () => {
            const res = await request(app)
                .get(`/api/recommendations/related?productId=${productId}&limit=5`);
            expect(res.statusCode).toBe(200);
            expect(res.body).toHaveProperty('products');
        });
    });
});