import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.USER_DATA_PATH
    ? path.join(process.env.USER_DATA_PATH, 'aroma.db')
    : (process.env.DB_PATH || path.join(__dirname, 'database', 'aroma.db'));

console.log('Migrating app_settings at:', dbPath);
const db = new Database(dbPath);

try {
    // 1. Rename existing table
    db.prepare('ALTER TABLE app_settings RENAME TO app_settings_old').run();

    // 2. Create new table without CHECK constraint on theme
    db.prepare(`
        CREATE TABLE app_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          theme TEXT DEFAULT 'default', 
          primary_color TEXT DEFAULT '#000000',
          logo_path TEXT,
          receipt_footer_text TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // 3. Copy data
    db.prepare(`
        INSERT INTO app_settings (id, theme, primary_color, logo_path, receipt_footer_text, updated_at)
        SELECT id, theme, primary_color, logo_path, receipt_footer_text, updated_at FROM app_settings_old
    `).run();

    // 4. Drop old table
    db.prepare('DROP TABLE app_settings_old').run();

    console.log('Migration of app_settings completed successfully.');

} catch (error) {
    console.error('Migration failed:', error);
    // Attempt rollback if table was renamed but not fully migrated?
    // For simplicity in this script, we assume consistent state or manual recovery if hard crash.
}
