import db from './database/db.js';

console.log('🔄 Starting activity_logs table creation...');

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            details TEXT,
            ip_address TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    `);

    console.log('✅ activity_logs table created successfully');

} catch (error) {
    console.error('❌ Migration failed:', error.message);
}
