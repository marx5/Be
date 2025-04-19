const { sequelize } = require('../config/database');
const User = require('./User');
const Address = require('./Address');
const PasswordReset = require('./PasswordReset');
const Category = require('./Category');
const Product = require('./Product');
const ProductImage = require('./ProductImage');
const ProductVariant = require('./ProductVariant');
const Cart = require('./Cart');
const CartItem = require('./CartItem');
const Order = require('./Order');
const OrderItem = require('./OrderItem');
const Payment = require('./Payment');
const PaymentAttempt = require('./PaymentAttempt');
const Review = require('./Review');
const ReviewReply = require('./ReviewReply');
const Promotion = require('./Promotion');
const PromotionCategory = require('./PromotionCategory');
const Wishlist = require('./Wishlist');
const Notification = require('./Notification');
const RefreshToken = require('./RefreshToken');
const PaymentTransaction = require('./PaymentTransaction');
const ReviewLog = require('./ReviewLog');
const UserView = require('./UserView');

// Định nghĩa mối quan hệ
// Users
User.hasMany(Address, { foreignKey: 'userId' });
User.hasMany(PasswordReset, { foreignKey: 'userId' });
User.hasOne(Cart, { foreignKey: 'userId' });
User.hasMany(Order, { foreignKey: 'userId' });
User.hasMany(Review, { foreignKey: 'userId' });
User.hasMany(ReviewReply, { foreignKey: 'userId' });
User.hasMany(Wishlist, { foreignKey: 'userId' });
User.hasMany(Notification, { foreignKey: 'userId' });
User.hasMany(RefreshToken, { foreignKey: 'userId' });
User.hasMany(ReviewLog, { foreignKey: 'userId' });
User.hasMany(UserView, { foreignKey: 'userId', as: 'UserViews' });


Address.belongsTo(User, { foreignKey: 'userId' });
PasswordReset.belongsTo(User, { foreignKey: 'userId' });
RefreshToken.belongsTo(User, { foreignKey: 'userId' });

// Categories
Category.hasMany(Product, { foreignKey: 'categoryId' });
Category.hasMany(Category, { foreignKey: 'parentId', as: 'SubCategories' });
Category.belongsTo(Category, { foreignKey: 'parentId', as: 'ParentCategory' });

// Products
Product.belongsTo(Category, { foreignKey: 'categoryId' });
Product.hasMany(ProductImage, { foreignKey: 'productId' });
Product.hasMany(ProductVariant, { foreignKey: 'productId' });
Product.hasMany(Review, { foreignKey: 'productId' });
Product.hasMany(Wishlist, { foreignKey: 'productId' });
Product.hasMany(UserView, { foreignKey: 'productId', as: 'UserViews' });


ProductImage.belongsTo(Product, { foreignKey: 'productId' });
ProductVariant.belongsTo(Product, { foreignKey: 'productId' });

// Carts
Cart.belongsTo(User, { foreignKey: 'userId' });
Cart.hasMany(CartItem, { foreignKey: 'cartId' });

CartItem.belongsTo(Cart, { foreignKey: 'cartId' });
CartItem.belongsTo(ProductVariant, { foreignKey: 'productVariantId' });

// Orders
Order.belongsTo(User, { foreignKey: 'userId' });
Order.belongsTo(Address, { foreignKey: 'addressId' });
Order.belongsTo(Promotion, { foreignKey: 'promotionId' });
Order.hasMany(OrderItem, { foreignKey: 'orderId' });
Order.hasOne(Payment, { foreignKey: 'orderId' });
Order.hasMany(PaymentTransaction, { foreignKey: 'orderId' });

OrderItem.belongsTo(Order, { foreignKey: 'orderId' });
OrderItem.belongsTo(ProductVariant, { foreignKey: 'productVariantId' });

// Payments
Payment.belongsTo(Order, { foreignKey: 'orderId' });
Payment.hasMany(PaymentAttempt, { foreignKey: 'paymentId' });

PaymentAttempt.belongsTo(Payment, { foreignKey: 'paymentId' });

// Reviews
Review.belongsTo(User, { foreignKey: 'userId' });
Review.belongsTo(Product, { foreignKey: 'productId' });
Review.hasMany(ReviewReply, { foreignKey: 'reviewId' });

ReviewReply.belongsTo(Review, { foreignKey: 'reviewId' });
ReviewReply.belongsTo(User, { foreignKey: 'userId' });

// Promotions
Promotion.hasMany(Order, { foreignKey: 'promotionId' });
Promotion.hasMany(PromotionCategory, { foreignKey: 'promotionId' });
Promotion.belongsTo(User, { foreignKey: 'userSpecific', as: 'User' });
Promotion.belongsTo(Category, { foreignKey: 'applicableCategoryId', as: 'Category' });
Promotion.belongsTo(Product, { foreignKey: 'applicableProductId', as: 'Product' });

PromotionCategory.belongsTo(Promotion, { foreignKey: 'promotionId' });
PromotionCategory.belongsTo(Category, { foreignKey: 'categoryId' });

// Wishlists
Wishlist.belongsTo(User, { foreignKey: 'userId' });
Wishlist.belongsTo(Product, { foreignKey: 'productId' });

// Notifications
Notification.belongsTo(User, { foreignKey: 'userId' });

//
PaymentTransaction.belongsTo(Order, { foreignKey: 'orderId' });

//
ReviewLog.belongsTo(User, { foreignKey: 'userId' });

//
UserView.belongsTo(User, { foreignKey: 'userId', as: 'User' });
UserView.belongsTo(Product, { foreignKey: 'productId', as: 'Product' });


module.exports = {
    sequelize,
    User,
    Address,
    PasswordReset,
    Category,
    Product,
    ProductImage,
    ProductVariant,
    Cart,
    CartItem,
    Order,
    OrderItem,
    Payment,
    PaymentAttempt,
    Review,
    ReviewReply,
    Promotion,
    PromotionCategory,
    Wishlist,
    Notification,
    RefreshToken,
    PaymentTransaction,
    ReviewLog,
    UserView,
};