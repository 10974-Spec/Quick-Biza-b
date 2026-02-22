/**
 * One-shot script: creates/updates the 'dev' admin user with password 'dev123'
 * and ensures the license is active with ALL modules.
 * Run: node backend/scripts/createDevUser.mjs
 */
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, '../database/aroma.db'));

const USERNAME = 'dev';
const PASSWORD = 'dev123';
const FULL_NAME = 'Dev Admin';
const ROLE = 'admin';

// 1. Hash the password
const hash = await bcrypt.hash(PASSWORD, 10);

// 2. Upsert the dev user
const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(USERNAME);
if (existing) {
    db.prepare(`
        UPDATE users
        SET password_hash = ?, status = 'approved', role = ?
        WHERE username = ?
    `).run(hash, ROLE, USERNAME);
    console.log(`✅ Updated existing user '${USERNAME}'`);
} else {
    db.prepare(`
        INSERT INTO users (username, password_hash, full_name, role, status, company_id)
        VALUES (?, ?, ?, ?, 'approved', 1)
    `).run(USERNAME, hash, FULL_NAME, ROLE);
    console.log(`✅ Created new user '${USERNAME}'`);
}

// 3. Ensure license is active with all modules
const ALL_MODULES = JSON.stringify([
    'pos', 'inventory', 'reports', 'settings', 'customers', 'payroll',
    'accounting', 'manufacturing', 'multi_branch', 'marketing',
    'loyalty', 'iot', 'online_store', 'fleet'
]);
db.prepare(`
    UPDATE license_store
    SET status = 'active', expiry_date = '2037-01-01', modules_enabled = ?, last_verified_at = datetime('now')
`).run(ALL_MODULES);
console.log('✅ License activated with ALL modules until 2037');

console.log('\n─────────────────────────────────');
console.log('  Login credentials:');
console.log(`  Username : ${USERNAME}`);
console.log(`  Password : ${PASSWORD}`);
console.log('─────────────────────────────────\n');

db.close();
