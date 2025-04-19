const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');

// Thư mục lưu trữ hình ảnh
const PRODUCT_IMAGE_DIR = path.join(__dirname, '../../images/products');
const REVIEW_IMAGE_DIR = path.join(__dirname, '../../images/reviews');

// Đảm bảo thư mục tồn tại
const ensureDir = async (dirPath) => {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
        throw new Error(`Failed to create directory: ${error.message}`);
    }
};

// Xử lý hình ảnh: chuyển sang WebP, tạo thumbnail, lưu trữ
const processImage = async (file, identifier, index) => {
    const dir = identifier.startsWith('review_') ? REVIEW_IMAGE_DIR : PRODUCT_IMAGE_DIR;
    const folderName = identifier.startsWith('review_') ? identifier : identifier.toString();
    const productDir = path.join(dir, folderName);
    await ensureDir(productDir);

    // Kiểm tra định dạng file
    const allowedTypes = ['image/jpg', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype)) {
        throw new Error('Only JPG, JPEG, PNG, and WebP images are allowed');
    }

    // Kiểm tra kích thước file (VD: tối đa 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
        throw new Error('Image size must not exceed 5MB');
    }

    // Đường dẫn file WebP và thumbnail
    const imageName = `image${index + 1}.webp`;
    const thumbName = `thumb_${imageName}`;
    const imagePath = path.join(productDir, imageName);
    const thumbPath = path.join(productDir, thumbName);

    try {
        // Chuyển đổi sang WebP với chất lượng giảm xuống 60% để tối ưu hơn
        await sharp(file.buffer)
            .webp({ quality: 60 }) // Giảm chất lượng để tối ưu dung lượng
            .toFile(imagePath);

        // Tạo thumbnail (resize 150x150)
        await sharp(file.buffer)
            .resize(150, 150, { fit: 'cover' })
            .webp({ quality: 60 })
            .toFile(thumbPath);

        return {
            image: `/images/${identifier.startsWith('review_') ? 'reviews' : 'products'}/${folderName}/${imageName}`,
            thumb: `/images/${identifier.startsWith('review_') ? 'reviews' : 'products'}/${folderName}/${thumbName}`,
        };
    } catch (error) {
        throw new Error(`Failed to process image: ${error.message}`);
    }
};

// Xóa thư mục hình ảnh khi xóa sản phẩm hoặc đánh giá
const deleteProductImages = async (identifier) => {
    const dir = identifier.startsWith('review_') ? REVIEW_IMAGE_DIR : PRODUCT_IMAGE_DIR;
    const folderName = identifier.startsWith('review_') ? identifier : identifier.toString();
    const productDir = path.join(dir, folderName);
    try {
        await fs.rm(productDir, { recursive: true, force: true });
    } catch (error) {
        throw new Error(`Failed to delete images: ${error.message}`);
    }
};

module.exports = {
    processImage,
    deleteProductImages,
};