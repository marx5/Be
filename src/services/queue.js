const Queue = require('bull');
const redis = require('../config/redis');
const { Notification } = require('../models');

const notificationQueue = new Queue('notification-queue', {
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
    },
});

notificationQueue.process(async (job) => {
    const { userId, title, message, type = 'system' } = job.data;
    await Notification.create({ userId, title, message, type, status: false });
});

module.exports = {
    notificationQueue,
};