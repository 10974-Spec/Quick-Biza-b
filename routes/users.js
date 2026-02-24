import express from 'express';
import db from '../database/db.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import activityLogger from '../services/activityLogger.js';
import bcrypt from 'bcryptjs';
import multer from 'multer';

import path from 'path';
import fs from 'fs';
import os from 'os';

const router = express.Router();
const _uploadsBase = process.env.USER_DATA_PATH || path.join(os.homedir(), '.config', 'quickbiza');
const _profilesDir = path.join(_uploadsBase, 'uploads', 'profiles');
if (!fs.existsSync(_profilesDir)) fs.mkdirSync(_profilesDir, { recursive: true });
const upload = multer({ dest: _profilesDir });

// Get all users (admin only)
router.get('/', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const users = db.prepare(`
            SELECT id, username, full_name, role, permissions, status, created_at, last_login
            FROM users
            WHERE company_id = ?
            ORDER BY created_at DESC
        `).all(req.user.company_id);


        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Create Invite Code (admin only)
router.post('/invite', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const { role, permissions, shop_name } = req.body;

        if (!role) {
            return res.status(400).json({ error: 'Role is required' });
        }

        // Generate simple 8-char code
        const code = Math.random().toString(36).substring(2, 10).toUpperCase();

        const permissionsJson = permissions ? JSON.stringify(permissions) : null;

        const result = db.prepare(`
            INSERT INTO invites (code, role, permissions, shop_name, created_by)
            VALUES (?, ?, ?, ?, ?)
        `).run(code, role, permissionsJson, shop_name, req.user.id);

        activityLogger.log(req.user.id, 'create_invite', { code, role }, req.ip);

        res.status(201).json({
            message: 'Invite code created successfully',
            code,
            inviteId: result.lastInsertRowid
        });
    } catch (error) {
        console.error('Error creating invite:', error);
        res.status(500).json({ error: 'Failed to create invite' });
    }
});

// Create new user (admin only)
router.post('/', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const { username, password, full_name, role, permissions } = req.body;

        if (!username || !password || !full_name || !role) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Check if username exists
        const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existing) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const permissionsJson = permissions ? JSON.stringify(permissions) : null;

        const result = db.prepare(`
            INSERT INTO users (username, password_hash, full_name, role, permissions, status, created_by, company_id)
            VALUES (?, ?, ?, ?, ?, 'approved', ?, ?)
        `).run(username, hashedPassword, full_name, role, permissionsJson, req.user.id, req.user.company_id);


        activityLogger.log(req.user.id, 'create_user', { new_user_id: result.lastInsertRowid, username }, req.ip);

        res.status(201).json({ message: 'User created successfully', userId: result.lastInsertRowid });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// Get single user (admin only)
router.get('/:id', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const { id } = req.params;
        const user = db.prepare(`
            SELECT id, username, full_name, role, permissions, status, created_at, profile_image
            FROM users
            WHERE id = ? AND company_id = ?
        `).get(id, req.user.company_id);


        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(user);
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

// Get user activity history
router.get('/:id/activity', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const { id } = req.params;
        const limit = req.query.limit || 50;

        // Verify user belongs to company
        const user = db.prepare('SELECT id FROM users WHERE id = ? AND company_id = ?').get(id, req.user.company_id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const logs = db.prepare(`
            SELECT * FROM activity_logs 
            WHERE user_id = ? 
            ORDER BY timestamp DESC 
            LIMIT ?
        `).all(id, limit);

        res.json(logs);
    } catch (error) {
        console.error('Error fetching activity:', error);
        res.status(500).json({ error: 'Failed to fetch user activity' });
    }
});

// Update user status (admin only)
router.patch('/:id/status', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status || !['approved', 'pending', 'rejected', 'disabled'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be: approved, pending, rejected, or disabled' });
        }

        // Check if user exists and belongs to company
        const user = db.prepare('SELECT id FROM users WHERE id = ? AND company_id = ?').get(id, req.user.company_id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Update status
        const update = db.prepare(`
            UPDATE users
            SET status = ?
            WHERE id = ? AND company_id = ?
        `);

        update.run(status, id, req.user.company_id);

        activityLogger.log(req.user.id, 'update_user_status', { target_user_id: id, status }, req.ip);

        res.json({ message: 'User status updated successfully', status });
    } catch (error) {
        console.error('Error updating user status:', error);
        res.status(500).json({ error: 'Failed to update user status' });
    }
});

// Update user role (admin only)
router.patch('/:id/role', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;

        if (!role || !['admin', 'manager', 'cashier', 'baker'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role. Must be: admin, manager, cashier, or baker' });
        }

        // Check if user exists and belongs to company
        const user = db.prepare('SELECT id FROM users WHERE id = ? AND company_id = ?').get(id, req.user.company_id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Update role
        const update = db.prepare(`
            UPDATE users
            SET role = ?
            WHERE id = ? AND company_id = ?
        `);

        update.run(role, id, req.user.company_id);

        activityLogger.log(req.user.id, 'update_user_role', { target_user_id: id, role }, req.ip);

        res.json({ message: 'User role updated successfully', role });
    } catch (error) {
        console.error('Error updating user role:', error);
        res.status(500).json({ error: 'Failed to update user role' });
    }
});

// Update user permissions (admin only)
router.patch('/:id/permissions', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const { id } = req.params;
        const { permissions } = req.body;

        // Check if user exists and belongs to company
        const user = db.prepare('SELECT id FROM users WHERE id = ? AND company_id = ?').get(id, req.user.company_id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const permissionsJson = permissions ? JSON.stringify(permissions) : null;

        // Update permissions
        const update = db.prepare(`
            UPDATE users
            SET permissions = ?
            WHERE id = ? AND company_id = ?
        `);

        update.run(permissionsJson, id, req.user.company_id);

        activityLogger.log(req.user.id, 'update_user_permissions', { target_user_id: id }, req.ip);

        res.json({ message: 'User permissions updated successfully', permissions });
    } catch (error) {
        console.error('Error updating user permissions:', error);
        res.status(500).json({ error: 'Failed to update user permissions' });
    }
});

// Delete user (admin only)
router.delete('/:id', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const { id } = req.params;

        // Prevent deleting yourself
        if (req.user.id === parseInt(id)) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }

        // Check if user exists and belongs to company
        const user = db.prepare('SELECT id FROM users WHERE id = ? AND company_id = ?').get(id, req.user.company_id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Delete user
        const deleteStmt = db.prepare('DELETE FROM users WHERE id = ? AND company_id = ?');
        deleteStmt.run(id, req.user.company_id);

        activityLogger.log(req.user.id, 'delete_user', { target_user_id: id }, req.ip);

        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// Update user profile (self or admin)
router.patch('/:id', authenticateToken, upload.single('profile_image'), async (req, res) => {
    try {
        const { id } = req.params;
        const { username, full_name, password, current_password } = req.body;
        const profile_image = req.file;

        // Allow users to update their own profile, or admins to update anyone in their company
        if (req.user.id !== parseInt(id) && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Permission denied' });
        }

        // Check if user exists and belongs to company (if admin) or is self
        // If regular user updating self, company check is implicit by ID, but good to be safe if ID param is tampered
        let userQuery = 'SELECT id, password_hash, company_id FROM users WHERE id = ?';
        const queryParams = [id];

        // If admin updating another user, ensure they are in same company
        if (req.user.role === 'admin') {
            userQuery += ' AND company_id = ?';
            queryParams.push(req.user.company_id);
        }

        const user = db.prepare(userQuery).get(...queryParams);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Extra safety: if self-update, ensure company matches (though auth token should guarantee this)
        if (req.user.id === parseInt(id) && user.company_id !== req.user.company_id) {
            return res.status(403).json({ error: 'Tenant mismatch' });
        }

        const updates = [];
        const params = [];

        if (username) {
            // Check uniqueness if username changed - GLOBALLY UNIQUE or PER COMPANY? 
            // Usually usernames are global login identifiers, so global uniqueness is safer.
            // But let's check global uniqueness first.
            const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, id);
            if (existing) {
                return res.status(400).json({ error: 'Username already taken' });
            }
            updates.push('username = ?');
            params.push(username);
        }

        if (full_name) {
            updates.push('full_name = ?');
            params.push(full_name);
        }

        if (password) {
            // Require current password for password changes
            if (!current_password) {
                return res.status(400).json({ error: 'Current password is required to set a new password' });
            }

            const validPassword = await bcrypt.compare(current_password, user.password_hash);
            if (!validPassword) {
                return res.status(401).json({ error: 'Incorrect current password' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            updates.push('password_hash = ?');
            params.push(hashedPassword);
        }

        if (profile_image) {
            updates.push('profile_image = ?');
            params.push(profile_image.filename);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No changes provided' });
        }

        params.push(id);

        const updateQuery = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
        db.prepare(updateQuery).run(...params);

        // specific activity log
        activityLogger.log(req.user.id, 'update_profile', { target_user_id: id, changes: updates.filter(u => !u.includes('password')) }, req.ip);

        res.json({ message: 'Profile updated successfully', profile_image: profile_image ? profile_image.filename : undefined });

    } catch (error) {
        console.error('Error updating user profile:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});


// Verify Admin Credentials (for sensitive actions)
router.post('/verify-admin', authenticateToken, async (req, res) => {
    try {
        const { password } = req.body;

        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }

        // Use the logged-in user's ID from the token
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        // Verify role (although authenticateToken likely checks this or subsequent middleware does, explicitly check here for the sensitive action)
        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'User is not an admin' });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid password' });
        }

        // Log verification success
        activityLogger.log(req.user.id, 'verify_admin', { verified_user_id: user.id }, req.ip);

        res.json({ verified: true });
    } catch (error) {
        console.error('Error verifying admin:', error);
        res.status(500).json({ error: 'Verification failed' });
    }
});

export default router;
