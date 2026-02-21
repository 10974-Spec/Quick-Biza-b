import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.USER_DATA_PATH
    ? path.join(process.env.USER_DATA_PATH, 'aroma.db')
    : (process.env.DB_PATH || path.join(__dirname, 'database', 'aroma.db'));

console.log('Migrating database at:', dbPath);
const db = new Database(dbPath);

try {
    // Check if columns exist
    const tableInfo = db.pragma('table_info(users)');
    const columns = tableInfo.map(c => c.name);

    if (!columns.includes('email')) {
        console.log('Adding email column...');
        db.prepare('ALTER TABLE users ADD COLUMN email TEXT').run();
        db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)').run();
    }

    if (!columns.includes('phone')) {
        console.log('Adding phone column...');
        db.prepare('ALTER TABLE users ADD COLUMN phone TEXT').run();
    }

    if (!columns.includes('profile_picture')) {
        console.log('Adding profile_picture column...');
        db.prepare('ALTER TABLE users ADD COLUMN profile_picture TEXT').run();
    }

    console.log('Migration completed successfully.');
} catch (error) {
    console.error('Migration failed:', error);
}
