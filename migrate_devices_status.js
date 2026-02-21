import db from './database/db.js';

console.log('🔄 Starting devices table status migration...');

try {
    // 1. Create new table with updated status constraint
    db.exec(`
        CREATE TABLE IF NOT EXISTS devices_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_name TEXT NOT NULL,
            device_identifier TEXT UNIQUE NOT NULL,
            device_type TEXT NOT NULL,
            browser TEXT,
            ip_address TEXT,
            user_id INTEGER,
            status TEXT DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'offline')),
            last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            vendor_id TEXT,
            product_id TEXT,
            path TEXT,
            port INTEGER,
            is_default BOOLEAN DEFAULT 0,
            device_category TEXT DEFAULT 'software',
            connection_type TEXT DEFAULT 'unknown',
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
    `);

    // 2. Copy data
    db.exec(`
        INSERT INTO devices_new (
            id, device_name, device_identifier, device_type, browser, ip_address, 
            user_id, status, last_active, created_at, vendor_id, product_id, 
            path, port, is_default, device_category, connection_type
        )
        SELECT 
            id, device_name, device_identifier, device_type, browser, ip_address, 
            user_id, status, last_active, created_at, vendor_id, product_id, 
            path, port, is_default, device_category, connection_type
        FROM devices;
    `);

    // 3. Drop old table and rename new one
    db.exec('DROP TABLE devices;');
    db.exec('ALTER TABLE devices_new RENAME TO devices;');

    // 4. Recreate trigger if exists (assuming none for now based on previous files)

    console.log('✅ Devices table status migration completed successfully');

} catch (error) {
    console.error('❌ Migration failed:', error.message);
}
