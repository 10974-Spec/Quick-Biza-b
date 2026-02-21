import jwt from 'jsonwebtoken';
import db from '../database/db.js';

// Verify JWT token middleware
export function authenticateToken(req, res, next) {
    const JWT_SECRET = process.env.JWT_SECRET || 'aroma-bakery-secret-key-2026';
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.error('JWT Verification Error:', err.message);
            return res.status(403).json({ error: 'Invalid or expired token' });
        }

        // Fetch fresh user data from database
        const currentUser = db.prepare('SELECT id, username, full_name, role, status, company_id FROM users WHERE id = ?').get(user.id);

        if (!currentUser) {
            console.error(`Auth Error: User ID ${user.id} not found in database`);
            return res.status(403).json({ error: 'User account not found' });
        }

        if (currentUser.status !== 'approved') {
            console.error(`Auth Error: User ID ${user.id} status is ${currentUser.status}`);
            return res.status(403).json({ error: 'User account is not active' });
        }


        req.user = currentUser;
        next();
    });
}

// Require specific role
export function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        next();
    };
}

// Require admin role
export function requireAdmin(req, res, next) {
    return requireRole('admin')(req, res, next);
}

// Generate JWT token
export function generateToken(user) {
    const JWT_SECRET = process.env.JWT_SECRET || 'aroma-bakery-secret-key-2026';
    return jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
}
