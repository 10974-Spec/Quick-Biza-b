import Database from 'better-sqlite3';
import { join } from 'path';

const dbPath = join(process.cwd(), 'database', 'aroma.db');
const db = new Database(dbPath);

try {
    db.exec(`ALTER TABLE users ADD COLUMN profile_image TEXT;`);
    console.log('Successfully added profile_image column to users table.');
} catch (error) {
    if (error.message.includes('duplicate column name')) {
        console.log('Column profile_image already exists.');
    } else {
        console.error('Error adding column:', error);
    }
}
