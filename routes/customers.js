import express from 'express';
import db from '../database/db.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { syncRecord } from '../services/syncService.js';
const router = express.Router();

// Get all customers
router.get('/', authenticateToken, (req, res) => {
    try {
        const { search, limit = 100, offset = 0 } = req.query;

        let query = 'SELECT * FROM customers WHERE 1=1';
        const params = [];

        if (search) {
            query += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }

        query += ' ORDER BY name ASC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const customers = db.prepare(query).all(...params);
        res.json(customers);
    } catch (error) {
        console.error('Error fetching customers:', error);
        res.status(500).json({ error: 'Failed to fetch customers' });
    }
});

// Get single customer
router.get('/:id', authenticateToken, (req, res) => {
    try {
        const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);

        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        const limit = parseInt(req.query.history_limit) || 10;

        // Get customer's orders
        const orders = db.prepare(`
      SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(req.params.id, limit);

        // Get customer's sales
        const sales = db.prepare(`
      SELECT * FROM sales WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(req.params.id, limit);

        customer.orders = orders;
        customer.sales = sales;

        res.json(customer);
    } catch (error) {
        console.error('Error fetching customer:', error);
        res.status(500).json({ error: 'Failed to fetch customer' });
    }
});

// Create customer
router.post('/', authenticateToken, (req, res) => {
    try {
        const { name, phone, email, birthday } = req.body;

        if (!name || !phone) {
            return res.status(400).json({ error: 'Name and phone are required' });
        }

        const insert = db.prepare(`
      INSERT INTO customers (name, phone, email, birthday, loyalty_points)
      VALUES (?, ?, ?, ?, 0)
    `);

        const result = insert.run(
            name,
            phone,
            email || null,
            birthday || null
        );

        res.status(201).json({
            message: 'Customer created successfully',
            customer_id: result.lastInsertRowid
        });
        syncRecord('customers', result.lastInsertRowid).catch(() => { });
    } catch (error) {
        console.error('Error creating customer:', error);
        console.error('Error details:', error.message);
        res.status(500).json({ error: 'Failed to create customer', details: error.message });
    }
});

// Update customer
router.put('/:id', authenticateToken, (req, res) => {
    try {
        const { name, phone, email, address, birthday } = req.body;

        const update = db.prepare(`
      UPDATE customers 
      SET name = ?, phone = ?, email = ?, address = ?, birthday = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

        const result = update.run(
            name,
            phone,
            email || null,
            address || null,
            birthday || null,
            req.params.id
        );

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        syncRecord('customers', req.params.id).catch(() => { });
        res.json({ message: 'Customer updated successfully' });
    } catch (error) {
        console.error('Error updating customer:', error);
        res.status(500).json({ error: 'Failed to update customer' });
    }
});

// Update loyalty points
router.patch('/:id/loyalty', authenticateToken, (req, res) => {
    try {
        const { points_change } = req.body;

        if (typeof points_change !== 'number') {
            return res.status(400).json({ error: 'Invalid points value' });
        }

        const customer = db.prepare('SELECT loyalty_points FROM customers WHERE id = ?').get(req.params.id);

        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        const newPoints = Math.max(0, customer.loyalty_points + points_change);

        const update = db.prepare('UPDATE customers SET loyalty_points = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        update.run(newPoints, req.params.id);

        res.json({
            message: 'Loyalty points updated successfully',
            new_points: newPoints
        });
    } catch (error) {
        console.error('Error updating loyalty points:', error);
        res.status(500).json({ error: 'Failed to update loyalty points' });
    }
});

// Delete customer
router.delete('/:id', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const deleteCustomer = db.prepare('DELETE FROM customers WHERE id = ?');
        const result = deleteCustomer.run(req.params.id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        res.json({ message: 'Customer deleted successfully' });
    } catch (error) {
        console.error('Error deleting customer:', error);
        res.status(500).json({ error: 'Failed to delete customer' });
    }
});

export default router;
