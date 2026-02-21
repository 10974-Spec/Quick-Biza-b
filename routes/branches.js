import express from 'express';
import db from '../database/db.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Get all branches
router.get('/', authenticateToken, (req, res) => {
    try {
        const branches = db.prepare(`
            SELECT b.*, u.full_name as manager_name
            FROM branches b
            LEFT JOIN users u ON b.manager_id = u.id
            ORDER BY b.created_at DESC
        `).all();

        res.json(branches);
    } catch (error) {
        console.error('Error fetching branches:', error);
        res.status(500).json({ error: 'Failed to fetch branches' });
    }
});

// Get single branch
router.get('/:id', authenticateToken, (req, res) => {
    try {
        const { id } = req.params;
        const branch = db.prepare(`
            SELECT b.*, u.full_name as manager_name
            FROM branches b
            LEFT JOIN users u ON b.manager_id = u.id
            WHERE b.id = ?
        `).get(id);

        if (!branch) {
            return res.status(404).json({ error: 'Branch not found' });
        }

        res.json(branch);
    } catch (error) {
        console.error('Error fetching branch:', error);
        res.status(500).json({ error: 'Failed to fetch branch' });
    }
});

// Create branch
router.post('/', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const { name, location, phone, manager_id } = req.body;

        if (!name || !location) {
            return res.status(400).json({ error: 'Name and location are required' });
        }

        const insert = db.prepare(`
            INSERT INTO branches (name, location, phone, manager_id)
            VALUES (?, ?, ?, ?)
        `);

        const result = insert.run(name, location, phone || null, manager_id || null);

        res.status(201).json({
            id: result.lastInsertRowid,
            message: 'Branch created successfully'
        });
    } catch (error) {
        console.error('Error creating branch:', error);
        res.status(500).json({ error: 'Failed to create branch' });
    }
});

// Update branch
router.put('/:id', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const { id } = req.params;
        const { name, location, phone, manager_id, status } = req.body;

        if (!name || !location) {
            return res.status(400).json({ error: 'Name and location are required' });
        }

        const update = db.prepare(`
            UPDATE branches
            SET name = ?, location = ?, phone = ?, manager_id = ?, status = ?
            WHERE id = ?
        `);

        const result = update.run(
            name,
            location,
            phone || null,
            manager_id || null,
            status || 'active',
            id
        );

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Branch not found' });
        }

        res.json({ message: 'Branch updated successfully' });
    } catch (error) {
        console.error('Error updating branch:', error);
        res.status(500).json({ error: 'Failed to update branch' });
    }
});

// Delete branch
router.delete('/:id', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const { id } = req.params;

        // Check if branch has transfers
        const transferCount = db.prepare(`
            SELECT COUNT(*) as count 
            FROM transfers 
            WHERE from_branch_id = ? OR to_branch_id = ?
        `).get(id, id);

        if (transferCount.count > 0) {
            return res.status(400).json({
                error: 'Cannot delete branch with existing transfers. Set status to inactive instead.'
            });
        }

        const deleteStmt = db.prepare('DELETE FROM branches WHERE id = ?');
        const result = deleteStmt.run(id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Branch not found' });
        }

        res.json({ message: 'Branch deleted successfully' });
    } catch (error) {
        console.error('Error deleting branch:', error);
        res.status(500).json({ error: 'Failed to delete branch' });
    }
});

export default router;
