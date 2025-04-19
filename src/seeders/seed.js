const bcrypt = require('bcryptjs');
const { User, Category, Product, ProductVariant, ProductImage } = require('../models');

async function seedDatabase() {
    try {
        // Seed Users (Admin)
        const adminExists = await User.findOne({ where: { email: 'admin@example.com' } });
        if (!adminExists) {
            await User.create({
                email: 'admin@example.com',
                password: await bcrypt.hash('admin123', 10),
                fullName: 'Admin User',
                phone: '0123456789',
                role: 'admin',
            });
            console.log('Admin user created');
        }

        // Seed Categories
        const categories = [
            { name: 'Áo', description: 'Danh mục áo' },
            { name: 'Quần', description: 'Danh mục quần' },
            { name: 'Áo sơ mi', description: 'Áo sơ mi nam/nữ', parentId: null },
        ];

        for (const category of categories) {
            const exists = await Category.findOne({ where: { name: category.name } });
            if (!exists) {
                const createdCategory = await Category.create(category);
                if (category.name === 'Áo sơ mi') {
                    await createdCategory.update({ parentId: (await Category.findOne({ where: { name: 'Áo' } })).id });
                }
            }
        }
        console.log('Categories seeded');

        // Seed Products
        const products = [
            {
                name: 'Áo thun nam',
                description: 'Áo thun cotton nam, thoải mái',
                price: 150000,
                discountPrice: 120000,
                categoryId: (await Category.findOne({ where: { name: 'Áo' } })).id,
                stock: 100,
                material: 'Cotton',
                brand: 'Generic',
            },
            {
                name: 'Quần jeans nữ',
                description: 'Quần jeans ống suông',
                price: 350000,
                categoryId: (await Category.findOne({ where: { name: 'Quần' } })).id,
                stock: 50,
                material: 'Denim',
                brand: 'Generic',
            },
        ];

        for (const product of products) {
            const exists = await Product.findOne({ where: { name: product.name } });
            if (!exists) {
                const createdProduct = await Product.create(product);
                // Seed Product Variants
                await ProductVariant.bulkCreate([
                    { productId: createdProduct.id, size: 'S', color: 'Black', stock: 20 },
                    { productId: createdProduct.id, size: 'M', color: 'White', stock: 30 },
                ]);
                // Seed Product Images
                await ProductImage.create({
                    productId: createdProduct.id,
                    image: `/images/${product.name.toLowerCase().replace(' ', '-')}.jpg`,
                    isPrimary: true,
                });
            }
        }
        console.log('Products seeded');
    } catch (error) {
        console.error('Error seeding database:', error);
    }
}

module.exports = { seedDatabase };