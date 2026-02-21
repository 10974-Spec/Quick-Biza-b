import express from 'express';
import db from '../database/db.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Get all transfers
router.get('/', authenticateToken, (req, res) => {
    try {
        const { status } = req.query;

        let query = `
            SELECT t.*, 
                   fb.name as from_branch_name,
                   tb.name as to_branch_name,
                   u.full_name as requested_by_name,
                   au.full_name as approved_by_name
            FROM transfers t
            LEFT JOIN branches fb ON t.from_branch_id = fb.id
            LEFT JOIN branches tb ON t.to_branch_id = tb.id
            LEFT JOIN users u ON t.requested_by = u.id
            LEFT JOIN users au ON t.approved_by = au.id
        `;

        if (status) {
            query += ` WHERE t.status = ?`;
        }

        query += ` ORDER BY t.created_at DESC`;

        const transfers = status
            ? db.prepare(query).all(status)
            : db.prepare(query).all();

        res.json(transfers);
    } catch (error) {
        console.error('Error fetching transfers:', error);
        res.status(500).json({ error: 'Failed to fetch transfers' });
    }
});

// Get single transfer
router.get('/:id', authenticateToken, (req, res) => {
    try {
        const { id } = req.params;
        const transfer = db.prepare(`
            SELECT t.*, 
                   fb.name as from_branch_name,
                   tb.name as to_branch_name,
                   u.full_name as requested_by_name,
                   au.full_name as approved_by_name
            FROM transfers t
            LEFT JOIN branches fb ON t.from_branch_id = fb.id
            LEFT JOIN branches tb ON t.to_branch_id = tb.id
            LEFT JOIN users u ON t.requested_by = u.id
            LEFT JOIN users au ON t.approved_by = au.id
            WHERE t.id = ?
        `).get(id);

        if (!transfer) {
            return res.status(404).json({ error: 'Transfer not found' });
        }

        res.json(transfer);
    } catch (error) {
        console.error('Error fetching transfer:', error);
        res.status(500).json({ error: 'Failed to fetch transfer' });
    }
});

// Create transfer
router.post('/', authenticateToken, requireRole('manager', 'admin'), (req, res) => {
    try {
        const { from_branch_id, to_branch_id, items, quantity, type, item_id, notes } = req.body;

        if (!from_branch_id || !to_branch_id || !items) {
            return res.status(400).json({ error: 'From branch, to branch, and items are required' });
        }

        if (from_branch_id === to_branch_id) {
            return res.status(400).json({ error: 'Cannot transfer to the same branch' });
        }

        // Verify branches exist
        const fromBranch = db.prepare('SELECT id FROM branches WHERE id = ?').get(from_branch_id);
        const toBranch = db.prepare('SELECT id FROM branches WHERE id = ?').get(to_branch_id);

        if (!fromBranch || !toBranch) {
            return res.status(404).json({ error: 'One or both branches not found' });
        }

        // Validate stock if specific item is selected
        if (type && item_id && quantity) {
            let stock = 0;
            if (type === 'product') {
                const product = db.prepare('SELECT quantity FROM inventory_finished WHERE product_id = ?').get(item_id);
                stock = product ? product.quantity : 0;
            } else if (type === 'ingredient') {
                const ingredient = db.prepare('SELECT quantity FROM inventory_raw WHERE ingredient_id = ?').get(item_id);
                stock = ingredient ? ingredient.quantity : 0;
            }

            if (quantity > stock) {
                return res.status(400).json({ error: `Insufficient stock. Available: ${stock}` });
            }
        }

        const insert = db.prepare(`
            INSERT INTO transfers (from_branch_id, to_branch_id, items, quantity, product_id, notes, requested_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        // If it's a product transfer, we can link it directly using product_id column if schema allows
        // The schema has product_id, but we should probably use it only if type is 'product'
        const dbProductId = type === 'product' ? item_id : null;

        const result = insert.run(
            from_branch_id,
            to_branch_id,
            items,
            quantity || null,
            dbProductId,
            notes || null,
            req.user.id
        );

        res.status(201).json({
            id: result.lastInsertRowid,
            message: 'Transfer created successfully'
        });
    } catch (error) {
        console.error('Error creating transfer:', error);
        res.status(500).json({ error: 'Failed to create transfer' });
    }
});

// Update transfer status
router.patch('/:id/status', authenticateToken, requireRole('manager', 'admin'), (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const validStatuses = ['pending', 'approved', 'in_transit', 'completed', 'cancelled'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({
                error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
            });
        }

        const update = db.prepare(`
            UPDATE transfers
            SET status = ?, approved_by = ?
            WHERE id = ?
        `);

        const result = update.run(
            status,
            status === 'approved' ? req.user.id : null,
            id
        );

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Transfer not found' });
        }

        res.json({ message: 'Transfer status updated successfully', status });
    } catch (error) {
        console.error('Error updating transfer status:', error);
        res.status(500).json({ error: 'Failed to update transfer status' });
    }
});

// Delete transfer
router.delete('/:id', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const { id } = req.params;

        const deleteStmt = db.prepare('DELETE FROM transfers WHERE id = ?');
        const result = deleteStmt.run(id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Transfer not found' });
        }

        res.json({ message: 'Transfer deleted successfully' });
    } catch (error) {
        console.error('Error deleting transfer:', error);
        res.status(500).json({ error: 'Failed to delete transfer' });
    }
});

export default router;
