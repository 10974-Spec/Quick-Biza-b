import db from './database/db.js';

console.log('🔄 Migrating devices table (v2)...');

const columnsToAdd = [
    { name: 'device_category', type: "TEXT DEFAULT 'software' CHECK(device_category IN ('software', 'hardware'))" }
];

const existingColumns = db.prepare('PRAGMA table_info(devices)').all().map(c => c.name);

db.transaction(() => {
    for (const col of columnsToAdd) {
        if (!existingColumns.includes(col.name)) {
            console.log(`➕ Adding column: ${col.name}`);
            try {
                db.exec(`ALTER TABLE devices ADD COLUMN ${col.name} ${col.type}`);

                // Update existing rows
                db.exec("UPDATE devices SET device_category = 'software' WHERE device_category IS NULL");
            } catch (error) {
                console.error(`❌ Failed to add column ${col.name}:`, error.message);
            }
        } else {
            console.log(`ℹ️ Column ${col.name} already exists.`);
        }
    }
})();

console.log('✅ Migration v2 completed.');
