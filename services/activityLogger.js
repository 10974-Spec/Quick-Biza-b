import db from '../database/db.js';

class ActivityLogger {
    async log(userId, action, details = null, ipAddress = null) {
        try {
            const stmt = db.prepare(`
                INSERT INTO activity_logs (user_id, action, details, ip_address, timestamp)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            `);

            const detailsStr = details ? JSON.stringify(details) : null;
            stmt.run(userId, action, detailsStr, ipAddress);

            console.log(`📝 Activity Logged: [${userId}] ${action}`);
        } catch (error) {
            console.error('Failed to log activity:', error);
            // Don't throw, we don't want to break the main flow for logging
        }
    }

    async getUserActivity(userId, limit = 50) {
        try {
            return db.prepare(`
                SELECT * FROM activity_logs 
                WHERE user_id = ? 
                ORDER BY timestamp DESC 
                LIMIT ?
            `).all(userId, limit);
        } catch (error) {
            console.error('Failed to get user activity:', error);
            return [];
        }
    }
}

export default new ActivityLogger();
