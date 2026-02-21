import db from './database/db.js';

console.log('🔄 Starting Multi-Tenancy Migration...');

try {
    // 1. Check if company_id column exists in users
    const tableInfo = db.prepare('PRAGMA table_info(users)').all();
    const hasCompanyId = tableInfo.some(col => col.name === 'company_id');

    if (!hasCompanyId) {
        console.log('⚠️ company_id column missing in users table. Adding it now...');

        // Add column
        db.exec('ALTER TABLE users ADD COLUMN company_id INTEGER DEFAULT 1');
        console.log('✅ company_id column added successfully with default value 1.');

        // Add foreign key constraint? SQLite ALTER TABLE is limited, so we rely on app logic mostly, 
        // or we would need to recreate the table. For now, simple column add is safer for existing data.

        // Verify
        const check = db.prepare('PRAGMA table_info(users)').all();
        const verified = check.some(col => col.name === 'company_id');
        if (verified) {
            console.log('✅ Verification successful: company_id exists.');
        } else {
            console.error('❌ Verification failed: company_id not found after ALTER.');
        }

    } else {
        console.log('✅ company_id column already exists in users table.');
    }

    // 2. Ensure Company Profile exists (ID 1)
    const companyCount = db.prepare('SELECT count(*) as count FROM company_profile').get();
    if (companyCount.count === 0) {
        console.log('⚠️ No company profile found. Creating default placeholder company...');
        db.prepare(`
            INSERT INTO company_profile (id, name, business_type, setup_completed)
            VALUES (1, 'Default Company', 'bakery', 1)
        `).run();
        console.log('✅ Default Company (ID: 1) created.');
    } else {
        console.log(`✅ Company profile exists (${companyCount.count} records).`);
    }

} catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
}
