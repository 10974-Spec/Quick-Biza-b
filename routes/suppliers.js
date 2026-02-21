import express from 'express';
import db from '../database/db.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
const router = express.Router();

// Get all suppliers
router.get('/', authenticateToken, (req, res) => {
    try {
        const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY name ASC').all();
        res.json(suppliers);
    } catch (error) {
        console.error('Error fetching suppliers:', error);
        res.status(500).json({ error: 'Failed to fetch suppliers' });
    }
});

// Get single supplier
router.get('/:id', authenticateToken, (req, res) => {
    try {
        const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);

        if (!supplier) {
            return res.status(404).json({ error: 'Supplier not found' });
        }

        const limit = parseInt(req.query.history_limit) || 20;

        // Get supplier's purchases
        const purchases = db.prepare(`
      SELECT * FROM purchases WHERE supplier_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(req.params.id, limit);

        supplier.purchases = purchases;
        res.json(supplier);
    } catch (error) {
        console.error('Error fetching supplier:', error);
        res.status(500).json({ error: 'Failed to fetch supplier' });
    }
});

// Create supplier
router.post('/', authenticateToken, requireRole('manager', 'admin'), (req, res) => {
    try {
        const { name, contact_person, phone, email, address } = req.body;

        if (!name || !phone) {
            return res.status(400).json({ error: 'Name and phone are required' });
        }

        const insert = db.prepare(`
      INSERT INTO suppliers (name, contact_person, phone, email, address)
      VALUES (?, ?, ?, ?, ?)
    `);

        const result = insert.run(
            name,
            contact_person || null,
            phone,
            email || null,
            address || null
        );

        res.status(201).json({
            message: 'Supplier created successfully',
            supplier_id: result.lastInsertRowid
        });
    } catch (error) {
        console.error('Error creating supplier:', error);
        console.error('Error details:', error.message);
        res.status(500).json({ error: 'Failed to create supplier', details: error.message });
    }
});

// Update supplier
router.put('/:id', authenticateToken, requireRole('manager', 'admin'), (req, res) => {
    try {
        const { name, contact_person, phone, email, address, category } = req.body;

        const update = db.prepare(`
      UPDATE suppliers 
      SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?, category = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

        const result = update.run(
            name,
            contact_person || null,
            phone,
            email || null,
            address || null,
            category || null,
            req.params.id
        );

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Supplier not found' });
        }

        res.json({ message: 'Supplier updated successfully' });
    } catch (error) {
        console.error('Error updating supplier:', error);
        res.status(500).json({ error: 'Failed to update supplier' });
    }
});

// Delete supplier
router.delete('/:id', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const deleteSupplier = db.prepare('DELETE FROM suppliers WHERE id = ?');
        const result = deleteSupplier.run(req.params.id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Supplier not found' });
        }

        res.json({ message: 'Supplier deleted successfully' });
    } catch (error) {
        console.error('Error deleting supplier:', error);
        res.status(500).json({ error: 'Failed to delete supplier' });
    }
});

// Update supplier
router.put('/:id', authenticateToken, requireRole('manager', 'admin'), (req, res) => {
    try {
        const { id } = req.params;
        const { name, contact_person, phone, email, address } = req.body;

        if (!name || !phone) {
            return res.status(400).json({ error: 'Name and phone are required' });
        }

        const update = db.prepare(`
            UPDATE suppliers 
            SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?
            WHERE id = ?
        `);

        const result = update.run(
            name,
            contact_person || null,
            phone,
            email || null,
            address || null,
            id
        );

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Supplier not found' });
        }

        res.json({ message: 'Supplier updated successfully' });
    } catch (error) {
        console.error('Error updating supplier:', error);
        console.error('Error details:', error.message);
        res.status(500).json({ error: 'Failed to update supplier', details: error.message });
    }
});

// Delete supplier
router.delete('/:id', authenticateToken, requireRole('manager', 'admin'), (req, res) => {
    try {
        const { id } = req.params;

        // Check if supplier has purchases
        const purchases = db.prepare('SELECT COUNT(*) as count FROM purchases WHERE supplier_id = ?').get(id);

        if (purchases.count > 0) {
            return res.status(400).json({
                error: 'Cannot delete supplier with existing purchases',
                details: `This supplier has ${purchases.count} purchase(s) associated with it.`
            });
        }

        const result = db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Supplier not found' });
        }

        res.json({ message: 'Supplier deleted successfully' });
    } catch (error) {
        console.error('Error deleting supplier:', error);
        console.error('Error details:', error.message);
        res.status(500).json({ error: 'Failed to delete supplier', details: error.message });
    }
});

export default router;
