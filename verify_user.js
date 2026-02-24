
import db from './database/db.js';
import bcrypt from 'bcryptjs';

const user = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');

if (user) {
    console.log('User admin found.');
    console.log('Role:', user.role);
    console.log('Status:', user.status);
    console.log('Password Hash:', user.password_hash);

    // Check default password
    bcrypt.compare('admin123', user.password_hash).then(result => {
        console.log('Password "admin123" is valid:', result);
    });
} else {
    console.log('User admin NOT found.');
}
