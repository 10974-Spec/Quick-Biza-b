
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = process.env.USER_DATA_PATH
    ? join(process.env.USER_DATA_PATH, 'aroma.db')
    : (process.env.DB_PATH || join(__dirname, 'database', 'aroma.db'));

console.log(`Using database: ${dbPath}`);
const db = new Database(dbPath);

const migrateRoles = () => {
    try {
        console.log('🔄 Starting Roles Migration...');

        // 1. Create Roles Table
        db.exec(`
            CREATE TABLE IF NOT EXISTS roles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                permissions TEXT, -- JSON array of strings
                is_system INTEGER DEFAULT 0, -- 1 for protected roles
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Roles table created.');

        // 2. Seed Default Roles
        const defaultRoles = [
            { name: 'admin', is_system: 1 },
            { name: 'manager', is_system: 1 },
            { name: 'cashier', is_system: 1 },
            { name: 'baker', is_system: 1 },
            { name: 'driver', is_system: 0 },
            { name: 'staff', is_system: 0 }
        ];

        const insertRole = db.prepare('INSERT OR IGNORE INTO roles (name, is_system) VALUES (?, ?)');
        defaultRoles.forEach(role => insertRole.run(role.name, role.is_system));
        console.log('✅ Default roles seeded.');

        // 3. Migrate Users Table
        // We need to remove the CHECK constraint on the role column.
        // SQLite doesn't support dropping constraints easily, so we must recreate the table.

        console.log('🔄 Migrating Users table schema...');

        db.exec('PRAGMA foreign_keys=OFF;');

        db.transaction(() => {
            // Rename existing table
            db.exec('ALTER TABLE users RENAME TO users_old;');

            // Create new table WITHOUT the CHECK constraint on role
            db.exec(`
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    full_name TEXT NOT NULL,
                    role TEXT NOT NULL, -- Constraint removed
                    permissions TEXT,
                    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'disabled')),
                    company_id INTEGER DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    created_by INTEGER,
                    last_login DATETIME,
                    FOREIGN KEY (created_by) REFERENCES users(id)
                );
            `);

            // Copy data
            db.exec(`
                INSERT INTO users (id, username, password_hash, full_name, role, permissions, status, company_id, created_at, created_by, last_login)
                SELECT id, username, password_hash, full_name, role, permissions, status, company_id, created_at, created_by, last_login
                FROM users_old;
            `);

            // Drop old table
            db.exec('DROP TABLE users_old;');
        })();

        db.exec('PRAGMA foreign_keys=ON;');
        console.log('✅ Users table migrated successfully.');

    } catch (error) {
        console.error('❌ Migration failed:', error);
    }
};

migrateRoles();
