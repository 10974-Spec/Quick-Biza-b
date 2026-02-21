import express from 'express';
import db from '../database/db.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Get recent returns
router.get('/', authenticateToken, (req, res) => {
    try {
        const logs = db.prepare(`
            SELECT il.*, 
                   u.full_name as created_by_name,
                   CASE 
                       WHEN il.type = 'finished' THEN p.name 
                       WHEN il.type = 'raw' THEN i.name 
                   END as item_name
            FROM inventory_logs il
            LEFT JOIN users u ON il.created_by = u.id
            LEFT JOIN products p ON il.type = 'finished' AND il.item_id = p.id
            LEFT JOIN ingredients i ON il.type = 'raw' AND il.item_id = i.id
            WHERE il.movement_type = 'return'
            ORDER BY il.created_at DESC
            LIMIT 50
        `).all();

        res.json(logs);
    } catch (error) {
        console.error('Error fetching returns:', error);
        res.status(500).json({ error: 'Failed to fetch returns' });
    }
});

// Create return
router.post('/', authenticateToken, (req, res) => {
    try {
        const { type, item_id, quantity, reason, notes } = req.body;

        if (!type || !item_id || !quantity) {
            return res.status(400).json({ error: 'Type, item ID, and quantity are required' });
        }

        if (quantity <= 0) {
            return res.status(400).json({ error: 'Quantity must be greater than 0' });
        }

        db.transaction(() => {
            // Update inventory
            if (type === 'product') {
                const current = db.prepare('SELECT quantity FROM inventory_finished WHERE product_id = ?').get(item_id);
                if (!current) throw new Error('Product not found in inventory');

                const newQuantity = current.quantity + quantity;
                db.prepare('UPDATE inventory_finished SET quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?')
                    .run(newQuantity, item_id);

                // Log movement
                db.prepare(`
                    INSERT INTO inventory_logs (type, item_id, movement_type, quantity_change, quantity_after, notes, created_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run('finished', item_id, 'return', quantity, newQuantity, notes || reason || 'Return', req.user.id);

            } else if (type === 'ingredient') {
                const current = db.prepare('SELECT quantity FROM inventory_raw WHERE ingredient_id = ?').get(item_id);
                if (!current) throw new Error('Ingredient not found in inventory');

                const newQuantity = current.quantity + quantity;
                db.prepare('UPDATE inventory_raw SET quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE ingredient_id = ?')
                    .run(newQuantity, item_id);

                // Log movement
                db.prepare(`
                    INSERT INTO inventory_logs (type, item_id, movement_type, quantity_change, quantity_after, notes, created_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run('raw', item_id, 'return', quantity, newQuantity, notes || reason || 'Return', req.user.id);
            } else {
                throw new Error('Invalid item type');
            }
        })();

        res.status(201).json({ message: 'Return processed successfully' });
    } catch (error) {
        console.error('Error processing return:', error);
        res.status(500).json({ error: error.message || 'Failed to process return' });
    }
});

export default router;
