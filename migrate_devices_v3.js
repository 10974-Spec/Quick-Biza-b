import db from './database/db.js';

console.log('🔄 Migrating devices table (v3)...');

const columnsToAdd = [
    { name: 'connection_type', type: "TEXT CHECK(connection_type IN ('wifi', 'ethernet', 'usb', 'bluetooth', 'serial', 'unknown'))" }
];

const existingColumns = db.prepare('PRAGMA table_info(devices)').all().map(c => c.name);

db.transaction(() => {
    for (const col of columnsToAdd) {
        if (!existingColumns.includes(col.name)) {
            console.log(`➕ Adding column: ${col.name}`);
            try {
                db.exec(`ALTER TABLE devices ADD COLUMN ${col.name} ${col.type}`);
                // Update existing rows
                db.exec("UPDATE devices SET connection_type = 'unknown' WHERE connection_type IS NULL");
            } catch (error) {
                console.error(`❌ Failed to add column ${col.name}:`, error.message);
            }
        } else {
            console.log(`ℹ️ Column ${col.name} already exists.`);
        }
    }
})();

console.log('✅ Migration v3 completed.');
