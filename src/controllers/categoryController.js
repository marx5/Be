const { body, validationResult } = require('express-validator');
const { Category, Product, ProductVariant, ProductImage } = require('../models');
const { Sequelize } = require('sequelize');

// Lấy danh sách danh mục (công khai)
const getCategories = async (req, res) => {
    try {
        const { level = 1 } = req.query; // Mức độ danh mục muốn lấy (1: cấp cao nhất, 2: cấp 2, v.v.)

        let include = [];
        if (level >= 2) {
            include = [{ model: Category, as: 'SubCategories' }];
            if (level >= 3) {
                include[0].include = [{ model: Category, as: 'SubCategories' }];
            }
        }

        const categories = await Category.findAll({
            include,
            where: { parentId: null },
        });

        res.status(200).json({ categories });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

// Lấy sản phẩm trong danh mục (công khai)
const getProductsByCategory = async (req, res) => {
    const { id } = req.params;
    const { page = 1, limit = 10, minPrice, maxPrice, color, size } = req.query;
    const offset = (page - 1) * limit;

    try {
        // Lấy tất cả danh mục con (đệ quy)
        const getAllSubCategoryIds = async (categoryId) => {
            const subCategories = await Category.findAll({ where: { parentId: categoryId } });
            let subCategoryIds = [categoryId];
            for (const subCat of subCategories) {
                const childIds = await getAllSubCategoryIds(subCat.id);
                subCategoryIds = subCategoryIds.concat(childIds);
            }
            return subCategoryIds;
        };

        const categoryIds = await getAllSubCategoryIds(id);

        const where = { categoryId: { [Sequelize.Op.in]: categoryIds } };
        if (minPrice && maxPrice) {
            where.price = { [Sequelize.Op.between]: [minPrice, maxPrice] };
        } else if (minPrice) {
            where.price = { [Sequelize.Op.gte]: minPrice };
        } else if (maxPrice) {
            where.price = { [Sequelize.Op.lte]: maxPrice };
        }

        const variantWhere = {};
        if (color) {
            variantWhere.color = color;
        }
        if (size) {
            variantWhere.size = size;
        }

        const { count, rows } = await Product.findAndCountAll({
            where,
            limit: parseInt(limit),
            offset,
            include: [
                {
                    model: ProductVariant,
                    as: 'ProductVariants',
                    where: variantWhere,
                    required: Object.keys(variantWhere).length > 0,
                },
                { model: ProductImage, as: 'ProductImages' },
            ],
        });

        res.status(200).json({
            products: rows,
            total: count,
            totalPages: Math.ceil(count / limit),
            currentPage: parseInt(page),
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

// Admin: Tạo danh mục mới
const createCategory = [
    body('name').notEmpty().withMessage('Category name is required'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { name, description, parentId } = req.body;

        try {
            // Kiểm tra parentId (nếu có)
            if (parentId) {
                const parent = await Category.findByPk(parentId);
                if (!parent) {
                    return res.status(404).json({ error: 'Parent category not found' });
                }
            }

            // Kiểm tra trùng tên trong cùng cấp
            const existingCategory = await Category.findOne({
                where: { name, parentId: parentId || null },
            });
            if (existingCategory) {
                return res.status(400).json({ error: 'Category name already exists at this level' });
            }

            const category = await Category.create({
                name,
                description,
                parentId,
            });

            res.status(201).json({ message: 'Category created successfully', category });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    },
];

// Admin: Cập nhật danh mục
const updateCategory = [
    body('name').notEmpty().withMessage('Category name is required'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { id } = req.params;
        const { name, description, parentId } = req.body;

        try {
            const category = await Category.findByPk(id);
            if (!category) {
                return res.status(404).json({ error: 'Category not found' });
            }

            // Kiểm tra parentId (nếu có)
            if (parentId) {
                const parent = await Category.findByPk(parentId);
                if (!parent) {
                    return res.status(404).json({ error: 'Parent category not found' });
                }
                // Ngăn danh mục trở thành chính cha của nó
                if (parentId === category.id) {
                    return res.status(400).json({ error: 'Category cannot be its own parent' });
                }

                // Kiểm tra vòng lặp danh mục
                const checkCircularReference = async (currentId, targetParentId) => {
                    if (currentId === targetParentId) return true;
                    const currentCat = await Category.findByPk(targetParentId);
                    if (!currentCat || !currentCat.parentId) return false;
                    return checkCircularReference(currentId, currentCat.parentId);
                };

                if (await checkCircularReference(category.id, parentId)) {
                    return res.status(400).json({ error: 'Circular reference detected' });
                }
            }

            // Kiểm tra trùng tên trong cùng cấp
            const existingCategory = await Category.findOne({
                where: { name, parentId: parentId || null, id: { [Sequelize.Op.ne]: id } },
            });
            if (existingCategory) {
                return res.status(400).json({ error: 'Category name already exists at this level' });
            }

            await category.update({ name, description, parentId });

            res.status(200).json({ message: 'Category updated successfully', category });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    },
];

// Admin: Xóa danh mục
const deleteCategory = async (req, res) => {
    const { id } = req.params;
    const { recursive = false } = req.query; // Tùy chọn xóa đệ quy

    try {
        const category = await Category.findByPk(id);
        if (!category) {
            return res.status(404).json({ error: 'Category not found' });
        }

        // Kiểm tra danh mục con
        const subCategories = await Category.findAll({ where: { parentId: id } });

        if (subCategories.length > 0) {
            if (!recursive) {
                return res.status(400).json({ error: 'Cannot delete category with subcategories. Use recursive=true to delete all.' });
            }

            // Xóa đệ quy
            for (const subCat of subCategories) {
                const subProducts = await Product.findAll({ where: { categoryId: subCat.id } });
                if (subProducts.length > 0) {
                    if (subCat.parentId) {
                        await Product.update({ categoryId: subCat.parentId }, { where: { categoryId: subCat.id } });
                    } else {
                        await Product.update({ categoryId: null }, { where: { categoryId: subCat.id } });
                    }
                }
                await subCat.destroy();
            }
        }

        // Xử lý sản phẩm trong danh mục hiện tại
        const products = await Product.findAll({ where: { categoryId: id } });
        if (products.length > 0) {
            if (category.parentId) {
                await Product.update({ categoryId: category.parentId }, { where: { categoryId: id } });
            } else {
                await Product.update({ categoryId: null }, { where: { categoryId: id } });
            }
        }

        await category.destroy();

        res.status(200).json({ message: 'Category deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = {
    getCategories,
    getProductsByCategory,
    createCategory,
    updateCategory,
    deleteCategory,
};