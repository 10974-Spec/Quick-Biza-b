import db from './database/db.js';

console.log('🔄 Checking users table schema...');

try {
    const tableInfo = db.prepare('PRAGMA table_info(users)').all();
    const hasLastLogin = tableInfo.some(col => col.name === 'last_login');

    if (!hasLastLogin) {
        console.log('⚠️ last_login column missing. Adding it now...');
        db.exec('ALTER TABLE users ADD COLUMN last_login DATETIME');
        console.log('✅ last_login column added successfully.');
    } else {
        console.log('✅ last_login column already exists.');
    }

} catch (error) {
    console.error('❌ Migration failed:', error.message);
}
