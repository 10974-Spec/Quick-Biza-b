import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import db from '../database/db.js';
import activityLogger from '../services/activityLogger.js';
import { generateToken } from '../middleware/auth.js';

const router = express.Router();

// Login endpoint
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        // Find user
        let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        let validPassword = false;

        if (user) {
            validPassword = await bcrypt.compare(password, user.password_hash);
        }

        // --- CLOUD FALLBACK LOGIC ---
        // If local user not found or password mismatched, attempt Cloud Login API fallback
        if (!user || !validPassword) {
            try {
                const cloudAPI = 'https://quickbiza-api.onrender.com/api';

                // AbortController gives a hard 15-second timeout (Render free tier cold-starts)
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000);

                let cloudRes;
                try {
                    cloudRes = await fetch(`${cloudAPI}/auth/login`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username, password, source: 'desktop-sync' }),
                        signal: controller.signal
                    });
                } finally {
                    clearTimeout(timeoutId);
                }

                if (cloudRes && cloudRes.ok) {
                    const data = await cloudRes.json();
                    const cloudUser = data.user;

                    const hashedPwd = await bcrypt.hash(password, 10);
                    const companyId = cloudUser.company_id || 1;

                    if (user) {
                        db.prepare(`UPDATE users SET password_hash = ?, full_name = ?, role = ?, company_id = ? WHERE username = ?`)
                            .run(hashedPwd, cloudUser.full_name, cloudUser.role, companyId, username);
                    } else {
                        db.prepare(`INSERT INTO users (username, password_hash, full_name, role, status, company_id) VALUES (?, ?, ?, ?, 'approved', ?)`)
                            .run(username, hashedPwd, cloudUser.full_name, cloudUser.role, companyId);
                    }

                    user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
                    validPassword = true;
                } else {
                    return res.status(401).json({ error: 'Invalid credentials' });
                }
            } catch (fallbackErr) {
                if (fallbackErr.name === 'AbortError') {
                    return res.status(503).json({ error: 'Cloud server is waking up. Please try again in 30 seconds.' });
                }
                return res.status(401).json({ error: 'Invalid credentials' });
            }
        }

        // License Verification (Bypass for Web App portal and admin users)
        const isWebPortal = req.body.source === 'web';
        const isAdmin = user && user.role === 'admin';

        if (!isWebPortal && !isAdmin) {
            const license = db.prepare('SELECT status, expiry_date FROM license_store ORDER BY id DESC LIMIT 1').get();
            if (!license) {
                return res.status(403).json({ error: 'Please activate a license to access QuickBiza. Use Get Started to register.', code: 'LICENSE_MISSING' });
            }
            if (license.status === 'expired' || (license.expiry_date && new Date(license.expiry_date) < new Date())) {
                return res.status(403).json({ error: 'Your license has expired. Please reactivate.', code: 'LICENSE_EXPIRED' });
            }
            if (license.status === 'revoked') {
                return res.status(403).json({ error: 'Your license has been revoked. Access denied.', code: 'LICENSE_REVOKED' });
            }
            if (license.status !== 'active') {
                return res.status(403).json({ error: 'License not activated. Access denied.', code: 'LICENSE_INACTIVE' });
            }
        }

        // Generate token
        const token = jwt.sign(
            {
                id: user.id,
                username: user.username,
                role: user.role,
                company_id: user.company_id || 1 // Fallback to 1 if missing
            },
            process.env.JWT_SECRET || 'aroma-bakery-secret-key-2026',
            { expiresIn: '24h' }
        );

        // Track device
        try {
            const userAgent = req.headers['user-agent'] || 'Unknown';
            const deviceIdentifier = req.body.device_identifier || req.headers['x-device-id'] || `${user.id}-${Date.now()}`;
            const ipAddress = req.ip || req.connection.remoteAddress;

            // Determine device type from user agent
            let deviceType = 'unknown';
            if (/mobile/i.test(userAgent)) deviceType = 'mobile';
            else if (/tablet|ipad/i.test(userAgent)) deviceType = 'tablet';
            else if (/desktop|windows|mac|linux/i.test(userAgent)) deviceType = 'desktop';

            // Extract browser info
            let browser = 'Unknown';
            if (/chrome/i.test(userAgent)) browser = 'Chrome';
            else if (/firefox/i.test(userAgent)) browser = 'Firefox';
            else if (/safari/i.test(userAgent)) browser = 'Safari';
            else if (/edge/i.test(userAgent)) browser = 'Edge';

            // Check if device exists
            const existingDevice = db.prepare('SELECT * FROM devices WHERE device_identifier = ?').get(deviceIdentifier);

            if (existingDevice) {
                // Update existing device
                db.prepare(`
                    UPDATE devices 
                    SET last_active = CURRENT_TIMESTAMP, 
                        ip_address = ?,
                        browser = ?,
                        device_type = ?
                    WHERE device_identifier = ?
                `).run(ipAddress, browser, deviceType, deviceIdentifier);
            } else {
                // Create new device
                const deviceName = `${browser} on ${deviceType.charAt(0).toUpperCase() + deviceType.slice(1)}`;
                db.prepare(`
                    INSERT INTO devices (device_name, device_identifier, device_type, browser, ip_address, user_id)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(deviceName, deviceIdentifier, deviceType, browser, ipAddress, user.id);
            }
        } catch (deviceError) {
            console.error('Device tracking error:', deviceError);
            // Don't fail login if device tracking fails
        }

        // Log activity
        activityLogger.log(user.id, 'login', { method: 'password' }, req.ip);

        // Update last_login
        db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

        // Return user data (without password hash)
        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                username: user.username,
                full_name: user.full_name,
                full_name: user.full_name,
                role: user.role,
                company_id: user.company_id || 1,
                permissions: user.permissions ? JSON.parse(user.permissions) : []
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Register with Invite Code
router.post('/register', async (req, res) => {
    try {
        const { username, password, full_name, invite_code } = req.body;

        if (!username || !password || !full_name || !invite_code) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Validate invite code with company context
        const invite = db.prepare(`
            SELECT i.*, u.company_id 
            FROM invites i 
            LEFT JOIN users u ON i.created_by = u.id 
            WHERE i.code = ? AND i.is_used = 0
        `).get(invite_code);

        if (!invite) {
            return res.status(400).json({ error: 'Invalid or expired invite code' });
        }

        // Check username
        const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existing) {
            return res.status(400).json({ error: 'Username already taken' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const companyId = invite.company_id || 1; // Fallback to 1

        // Transaction to create user and mark invite used
        const createUser = db.transaction(() => {
            const result = db.prepare(`
                INSERT INTO users (username, password_hash, full_name, role, permissions, status, company_id)
                VALUES (?, ?, ?, ?, ?, 'approved', ?)
            `).run(username, hashedPassword, full_name, invite.role, invite.permissions, companyId);

            db.prepare(`
                UPDATE invites 
                SET is_used = 1, used_at = CURRENT_TIMESTAMP, used_by = ?
                WHERE id = ?
            `).run(result.lastInsertRowid, invite.id);

            return result.lastInsertRowid;
        });

        const userId = createUser();

        activityLogger.log(userId, 'register', { method: 'invite', invite_code }, req.ip);

        res.status(201).json({ message: 'Registration successful. Please login.' });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Get current user info
router.get('/me', (req, res) => {
    // This would typically use authenticateToken middleware
    // For now, return basic structure
    res.json({ message: 'User info endpoint' });
});

export default router;
