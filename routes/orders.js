import express from 'express';
import db from '../database/db.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Get all orders
router.get('/', authenticateToken, (req, res) => {
    try {
        const { status, customer_id, limit = 50, offset = 0 } = req.query;

        let query = `
      SELECT o.*, c.name as customer_name, c.phone as customer_phone,
             u.full_name as created_by_name
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN users u ON o.created_by = u.id
      WHERE 1=1
    `;
        const params = [];

        if (status) {
            query += ' AND o.status = ?';
            params.push(status);
        }

        if (customer_id) {
            query += ' AND o.customer_id = ?';
            params.push(customer_id);
        }

        query += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const orders = db.prepare(query).all(...params);
        res.json(orders);
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

// Get single order with items
router.get('/:id', authenticateToken, (req, res) => {
    try {
        const order = db.prepare(`
      SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email,
             u.full_name as created_by_name
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN users u ON o.created_by = u.id
      WHERE o.id = ?
    `).get(req.params.id);

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // Get order items
        const items = db.prepare(`
      SELECT oi.*, p.name as product_name, p.emoji
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `).all(req.params.id);

        order.items = items;
        res.json(order);
    } catch (error) {
        console.error('Error fetching order:', error);
        res.status(500).json({ error: 'Failed to fetch order' });
    }
});

// Create new order
router.post('/', authenticateToken, (req, res) => {
    try {
        const {
            customer_id,
            product_name,
            quantity,
            unit_price,
            total_price,
            deposit_paid = 0,
            pickup_date,
            notes
        } = req.body;

        if (!customer_id || !product_name || !quantity || !total_price || !pickup_date) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const insertOrder = db.prepare(`
      INSERT INTO orders (customer_id, product_name, quantity, unit_price, total_price,
                         deposit_paid, balance, pickup_date, notes, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `);

        const balance_due = total_price - deposit_paid;

        const result = insertOrder.run(
            customer_id,
            product_name,
            quantity,
            unit_price || total_price / quantity,
            total_price,
            deposit_paid,
            balance_due,
            pickup_date,
            notes || null,
            req.user.id
        );

        res.status(201).json({
            message: 'Order created successfully',
            order_id: result.lastInsertRowid
        });
    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({ error: 'Failed to create order' });
    }
});

// Update order status
router.patch('/:id/status', authenticateToken, requireRole('manager', 'admin'), (req, res) => {
    try {
        const { status } = req.body;
        const validStatuses = ['pending', 'in_production', 'ready', 'completed', 'cancelled'];

        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const update = db.prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        const result = update.run(status, req.params.id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.json({ message: 'Order status updated successfully' });
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ error: 'Failed to update order status' });
    }
});

// Update order payment
router.patch('/:id/payment', authenticateToken, (req, res) => {
    try {
        const { additional_payment } = req.body;

        if (!additional_payment || additional_payment <= 0) {
            return res.status(400).json({ error: 'Invalid payment amount' });
        }

        const order = db.prepare('SELECT deposit_paid, balance FROM orders WHERE id = ?').get(req.params.id);

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const newDeposit = order.deposit_paid + additional_payment;
        const newBalance = Math.max(0, order.balance - additional_payment);

        const update = db.prepare(`
      UPDATE orders 
      SET deposit_paid = ?, balance = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);

        update.run(newDeposit, newBalance, req.params.id);

        res.json({
            message: 'Payment recorded successfully',
            new_deposit: newDeposit,
            new_balance: newBalance
        });
    } catch (error) {
        console.error('Error recording payment:', error);
        res.status(500).json({ error: 'Failed to record payment' });
    }
});

// Delete order
router.delete('/:id', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const deleteOrder = db.prepare('DELETE FROM orders WHERE id = ?');
        const result = deleteOrder.run(req.params.id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.json({ message: 'Order deleted successfully' });
    } catch (error) {
        console.error('Error deleting order:', error);
        res.status(500).json({ error: 'Failed to delete order' });
    }
});

export default router;
