import db from './database/db.js';

console.log('🔄 Migrating devices table...');

const columnsToAdd = [
    { name: 'vendor_id', type: 'TEXT' },
    { name: 'product_id', type: 'TEXT' },
    { name: 'path', type: 'TEXT' },
    { name: 'port', type: 'INTEGER' },
    { name: 'is_default', type: 'INTEGER DEFAULT 0' }
];

const existingColumns = db.prepare('PRAGMA table_info(devices)').all().map(c => c.name);

db.transaction(() => {
    for (const col of columnsToAdd) {
        if (!existingColumns.includes(col.name)) {
            console.log(`➕ Adding column: ${col.name}`);
            try {
                db.exec(`ALTER TABLE devices ADD COLUMN ${col.name} ${col.type}`);
            } catch (error) {
                console.error(`❌ Failed to add column ${col.name}:`, error.message);
            }
        } else {
            console.log(`ℹ️ Column ${col.name} already exists.`);
        }
    }
})();

console.log('✅ Migration completed.');
