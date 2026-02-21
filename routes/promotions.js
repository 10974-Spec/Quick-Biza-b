import express from 'express';
import db from '../database/db.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
const router = express.Router();

// Get all promotions
router.get('/', authenticateToken, (req, res) => {
    try {
        const { active_only } = req.query;

        let query = 'SELECT * FROM promotions WHERE 1=1';
        const params = [];

        if (active_only === 'true') {
            query += ' AND status = ? AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE';
            params.push('active');
        }

        query += ' ORDER BY created_at DESC';

        const promotions = db.prepare(query).all(...params);
        res.json(promotions);
    } catch (error) {
        console.error('Error fetching promotions:', error);
        res.status(500).json({ error: 'Failed to fetch promotions' });
    }
});

// Get single promotion
router.get('/:id', authenticateToken, (req, res) => {
    try {
        const promotion = db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id);

        if (!promotion) {
            return res.status(404).json({ error: 'Promotion not found' });
        }

        res.json(promotion);
    } catch (error) {
        console.error('Error fetching promotion:', error);
        res.status(500).json({ error: 'Failed to fetch promotion' });
    }
});

// Create promotion
router.post('/', authenticateToken, requireRole('manager', 'admin'), (req, res) => {
    try {
        const { name, type, value, start_date, end_date, conditions, status } = req.body;

        if (!name || !type || !value || !start_date || !end_date) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const validTypes = ['percentage', 'fixed_amount', 'buy_x_get_y'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ error: 'Invalid promotion type' });
        }

        const insert = db.prepare(`
      INSERT INTO promotions (name, type, value, start_date, end_date, conditions, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

        const result = insert.run(
            name,
            type,
            value,
            start_date,
            end_date,
            conditions || null,
            status || 'active'
        );

        res.status(201).json({
            message: 'Promotion created successfully',
            promotion_id: result.lastInsertRowid
        });
    } catch (error) {
        console.error('Error creating promotion:', error);
        res.status(500).json({ error: 'Failed to create promotion' });
    }
});

// Update promotion
router.put('/:id', authenticateToken, requireRole('manager', 'admin'), (req, res) => {
    try {
        const { name, type, value, start_date, end_date, conditions, status } = req.body;

        const update = db.prepare(`
      UPDATE promotions 
      SET name = ?, type = ?, value = ?, start_date = ?, end_date = ?, conditions = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

        const result = update.run(
            name,
            type,
            value,
            start_date,
            end_date,
            conditions || null,
            status,
            req.params.id
        );

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Promotion not found' });
        }

        res.json({ message: 'Promotion updated successfully' });
    } catch (error) {
        console.error('Error updating promotion:', error);
        res.status(500).json({ error: 'Failed to update promotion' });
    }
});

// Delete promotion
router.delete('/:id', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const deletePromotion = db.prepare('DELETE FROM promotions WHERE id = ?');
        const result = deletePromotion.run(req.params.id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Promotion not found' });
        }

        res.json({ message: 'Promotion deleted successfully' });
    } catch (error) {
        console.error('Error deleting promotion:', error);
        res.status(500).json({ error: 'Failed to delete promotion' });
    }
});

export default router;
