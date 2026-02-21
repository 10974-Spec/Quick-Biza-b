import db from './database/db.js';

const suppliers = db.prepare('SELECT count(*) as count FROM suppliers').get();
console.log('Supplier count:', suppliers.count);

if (suppliers.count === 0) {
    console.log('Seeding test supplier...');
    db.prepare("INSERT INTO suppliers (name, contact_person, phone, email) VALUES (?, ?, ?, ?)").run(
        'Test Supplier', 'John Doe', '0700000000', 'test@example.com'
    );
    console.log('Seeded.');
}
