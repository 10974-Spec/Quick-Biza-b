import express from 'express';
import db from '../database/db.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Get raw materials inventory
router.get('/raw', authenticateToken, (req, res) => {
    try {
        const companyId = req.user?.company_id || 1;
        const inventory = db.prepare(`
      SELECT ir.*, i.name, i.unit, i.low_stock_threshold
      FROM inventory_raw ir
      JOIN ingredients i ON ir.ingredient_id = i.id
      WHERE i.company_id = ?
      ORDER BY i.name
    `).all(companyId);

        res.json(inventory);
    } catch (error) {
        console.error('Error fetching raw inventory:', error);
        res.status(500).json({ error: 'Failed to fetch raw inventory' });
    }
});

// Get finished goods inventory
router.get('/finished', authenticateToken, (req, res) => {
    try {
        const companyId = req.user?.company_id || 1;
        const inventory = db.prepare(`
      SELECT if.*, p.name, p.price, p.emoji
      FROM inventory_finished if
      JOIN products p ON if.product_id = p.id
      WHERE p.active = 1 AND p.company_id = ?
      ORDER BY p.name
    `).all(companyId);

        res.json(inventory);
    } catch (error) {
        console.error('Error fetching finished inventory:', error);
        res.status(500).json({ error: 'Failed to fetch finished inventory' });
    }
});

// Get low stock alerts
router.get('/alerts', authenticateToken, (req, res) => {
    try {
        const companyId = req.user?.company_id || 1;
        const lowStockRaw = db.prepare(`
      SELECT ir.*, i.name, i.unit, i.low_stock_threshold
      FROM inventory_raw ir
      JOIN ingredients i ON ir.ingredient_id = i.id
      WHERE ir.quantity <= i.low_stock_threshold AND i.company_id = ?
      ORDER BY ir.quantity ASC
    `).all(companyId);

        const lowStockFinished = db.prepare(`
      SELECT if.*, p.name, p.emoji
      FROM inventory_finished if
      JOIN products p ON if.product_id = p.id
      WHERE if.quantity <= 10 AND p.active = 1 AND p.company_id = ?
      ORDER BY if.quantity ASC
    `).all(companyId);

        res.json({
            raw_materials: lowStockRaw,
            finished_goods: lowStockFinished
        });
    } catch (error) {
        console.error('Error fetching low stock alerts:', error);
        res.status(500).json({ error: 'Failed to fetch low stock alerts' });
    }
});

// Manual stock adjustment (Admin only)
router.post('/adjust', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const { type, item_id, quantity_change, notes } = req.body;

        if (!type || !item_id || quantity_change === undefined) {
            return res.status(400).json({ error: 'Type, item_id, and quantity_change are required' });
        }

        if (type === 'raw') {
            const current = db.prepare('SELECT quantity FROM inventory_raw WHERE ingredient_id = ?').get(item_id);
            const newQuantity = current.quantity + quantity_change;

            db.prepare('UPDATE inventory_raw SET quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE ingredient_id = ?')
                .run(newQuantity, item_id);

            db.prepare(`
        INSERT INTO inventory_logs (type, item_id, movement_type, quantity_change, quantity_after, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('raw', item_id, 'adjustment', quantity_change, newQuantity, notes, req.user.id);

        } else if (type === 'finished') {
            const current = db.prepare('SELECT quantity FROM inventory_finished WHERE product_id = ?').get(item_id);
            const newQuantity = current.quantity + quantity_change;

            db.prepare('UPDATE inventory_finished SET quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?')
                .run(newQuantity, item_id);

            db.prepare(`
        INSERT INTO inventory_logs (type, item_id, movement_type, quantity_change, quantity_after, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('finished', item_id, 'adjustment', quantity_change, newQuantity, notes, req.user.id);
        }

        res.json({ success: true, message: 'Inventory adjusted successfully' });
    } catch (error) {
        console.error('Error adjusting inventory:', error);
        res.status(500).json({ error: 'Failed to adjust inventory' });
    }
});

// Record waste
router.post('/waste', authenticateToken, (req, res) => {
    try {
        const { type, item_id, quantity, notes } = req.body;

        if (!type || !item_id || !quantity) {
            return res.status(400).json({ error: 'Type, item_id, and quantity are required' });
        }

        if (type === 'finished') {
            const current = db.prepare('SELECT quantity FROM inventory_finished WHERE product_id = ?').get(item_id);
            const newQuantity = current.quantity - quantity;

            db.prepare('UPDATE inventory_finished SET quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?')
                .run(newQuantity, item_id);

            db.prepare(`
        INSERT INTO inventory_logs (type, item_id, movement_type, quantity_change, quantity_after, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('finished', item_id, 'waste', -quantity, newQuantity, notes, req.user.id);
        }

        res.json({ success: true, message: 'Waste recorded successfully' });
    } catch (error) {
        console.error('Error recording waste:', error);
        res.status(500).json({ error: 'Failed to record waste' });
    }
});

// Get inventory movement logs
router.get('/logs', authenticateToken, (req, res) => {
    try {
        const { type, limit = 100 } = req.query;
        const companyId = req.user?.company_id || 1;

        let query = `
      SELECT il.*, u.full_name as created_by_name
      FROM inventory_logs il
      LEFT JOIN users u ON il.created_by = u.id
      WHERE u.company_id = ?
    `;

        const params = [companyId];

        if (type) {
            query += ' AND il.type = ?';
            params.push(type);
        }

        query += ' ORDER BY il.created_at DESC LIMIT ?';
        params.push(parseInt(limit));

        const logs = db.prepare(query).all(...params);
        res.json(logs);
    } catch (error) {
        console.error('Error fetching inventory logs:', error);
        res.status(500).json({ error: 'Failed to fetch inventory logs' });
    }
});

export default router;
