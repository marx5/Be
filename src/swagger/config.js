/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       required:
 *         - email
 *         - password
 *         - fullName
 *       properties:
 *         id:
 *           type: integer
 *           description: ID tự động tạo của người dùng
 *         email:
 *           type: string
 *           format: email
 *           description: Email người dùng
 *         fullName:
 *           type: string
 *           description: Họ tên đầy đủ
 *         phone:
 *           type: string
 *           description: Số điện thoại
 *         role:
 *           type: string
 *           enum: [user, admin]
 *           description: Vai trò người dùng
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Thời gian tạo
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Thời gian cập nhật
 * 
 *     Product:
 *       type: object
 *       required:
 *         - name
 *         - price
 *         - categoryId
 *       properties:
 *         id:
 *           type: integer
 *           description: ID tự động tạo của sản phẩm
 *         name:
 *           type: string
 *           description: Tên sản phẩm
 *         description:
 *           type: string
 *           description: Mô tả sản phẩm
 *         price:
 *           type: number
 *           format: float
 *           description: Giá gốc
 *         discountPrice:
 *           type: number
 *           format: float
 *           description: Giá khuyến mãi
 *         categoryId:
 *           type: integer
 *           description: ID danh mục
 *         stock:
 *           type: integer
 *           description: Số lượng tổng
 *         material:
 *           type: string
 *           description: Chất liệu
 *         brand:
 *           type: string
 *           description: Thương hiệu
 *         isAvailable:
 *           type: boolean
 *           description: Trạng thái hiển thị sản phẩm
 *
 *     Category:
 *       type: object
 *       required:
 *         - name
 *       properties:
 *         id:
 *           type: integer
 *           description: ID tự động tạo của danh mục
 *         name:
 *           type: string
 *           description: Tên danh mục
 *         description:
 *           type: string
 *           description: Mô tả danh mục
 *         parentId:
 *           type: integer
 *           nullable: true
 *           description: ID danh mục cha (nếu có)
 *
 *     ProductVariant:
 *       type: object
 *       required:
 *         - productId
 *       properties:
 *         id:
 *           type: integer
 *           description: ID tự động tạo của biến thể
 *         productId:
 *           type: integer
 *           description: ID sản phẩm
 *         size:
 *           type: string
 *           description: Kích cỡ
 *         color:
 *           type: string
 *           description: Màu sắc
 *         stock:
 *           type: integer
 *           description: Số lượng tồn kho
 *
 *     Order:
 *       type: object
 *       required:
 *         - userId
 *         - addressId
 *         - totalAmount
 *       properties:
 *         id:
 *           type: integer
 *           description: ID tự động tạo của đơn hàng
 *         userId:
 *           type: integer
 *           description: ID người dùng
 *         addressId:
 *           type: integer
 *           description: ID địa chỉ giao hàng
 *         status:
 *           type: string
 *           enum: [pending, processing, shipped, delivered, cancelled]
 *           description: Trạng thái đơn hàng
 *         totalAmount:
 *           type: number
 *           format: float
 *           description: Tổng giá trị đơn hàng
 *         paymentMethod:
 *           type: string
 *           enum: [COD, VNPay, PayPal]
 *           description: Phương thức thanh toán
 *
 *     Review:
 *       type: object
 *       required:
 *         - userId
 *         - productId
 *         - rating
 *       properties:
 *         id:
 *           type: integer
 *           description: ID tự động tạo của đánh giá
 *         userId:
 *           type: integer
 *           description: ID người dùng
 *         productId:
 *           type: integer
 *           description: ID sản phẩm
 *         rating:
 *           type: integer
 *           minimum: 1
 *           maximum: 5
 *           description: Số sao đánh giá (1-5)
 *         comment:
 *           type: string
 *           description: Nội dung đánh giá
 *         images:
 *           type: array
 *           items:
 *             type: string
 *           description: Danh sách hình ảnh
 *
 *     Promotion:
 *       type: object
 *       required:
 *         - code
 *         - discountType
 *         - discount
 *         - startDate
 *         - endDate
 *         - maxUses
 *       properties:
 *         id:
 *           type: integer
 *           description: ID tự động tạo của mã giảm giá
 *         code:
 *           type: string
 *           description: Mã giảm giá
 *         discountType:
 *           type: string
 *           enum: [percentage, fixed]
 *           description: Loại giảm giá (phần trăm hoặc cố định)
 *         discount:
 *           type: number
 *           format: float
 *           description: Giá trị giảm
 *         minOrderValue:
 *           type: number
 *           format: float
 *           description: Giá trị đơn hàng tối thiểu để áp dụng
 *         startDate:
 *           type: string
 *           format: date-time
 *           description: Ngày bắt đầu
 *         endDate:
 *           type: string
 *           format: date-time
 *           description: Ngày kết thúc
 */