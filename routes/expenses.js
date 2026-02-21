import express from 'express';
import db from '../database/db.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
const router = express.Router();

// Get all expenses
router.get('/', authenticateToken, (req, res) => {
    try {
        const { category, start_date, end_date, limit = 100, offset = 0 } = req.query;

        let query = `
      SELECT e.*, u.full_name as created_by_name
      FROM expenses e
      LEFT JOIN users u ON e.created_by = u.id
      WHERE 1=1
    `;
        const params = [];

        if (category) {
            query += ' AND e.category = ?';
            params.push(category);
        }

        if (start_date) {
            query += ' AND e.expense_date >= ?';
            params.push(start_date);
        }

        if (end_date) {
            query += ' AND e.expense_date <= ?';
            params.push(end_date);
        }

        query += ' ORDER BY e.expense_date DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const expenses = db.prepare(query).all(...params);
        res.json(expenses);
    } catch (error) {
        console.error('Error fetching expenses:', error);
        res.status(500).json({ error: 'Failed to fetch expenses' });
    }
});

// Get expense summary
router.get('/summary', authenticateToken, (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        let query = 'SELECT category, SUM(amount) as total FROM expenses WHERE 1=1';
        const params = [];

        if (start_date) {
            query += ' AND expense_date >= ?';
            params.push(start_date);
        }

        if (end_date) {
            query += ' AND expense_date <= ?';
            params.push(end_date);
        }

        query += ' GROUP BY category ORDER BY total DESC';

        const summary = db.prepare(query).all(...params);

        const total = summary.reduce((sum, item) => sum + item.total, 0);

        res.json({ summary, total });
    } catch (error) {
        console.error('Error fetching expense summary:', error);
        res.status(500).json({ error: 'Failed to fetch expense summary' });
    }
});

// Create expense
router.post('/', authenticateToken, requireRole('manager', 'admin'), (req, res) => {
    try {
        const { category, amount, description, date } = req.body;

        if (!category || !amount) {
            return res.status(400).json({ error: 'Category and amount are required' });
        }

        const insert = db.prepare(`
      INSERT INTO expenses (category, amount, description, expense_date, created_by)
      VALUES (?, ?, ?, ?, ?)
    `);

        const result = insert.run(
            category,
            amount,
            description || null,
            date || new Date().toISOString().split('T')[0],
            req.user.id
        );

        res.status(201).json({
            message: 'Expense recorded successfully',
            expense_id: result.lastInsertRowid
        });
    } catch (error) {
        console.error('Error creating expense:', error);
        res.status(500).json({ error: 'Failed to record expense' });
    }
});

// Update expense
router.put('/:id', authenticateToken, requireRole('manager', 'admin'), (req, res) => {
    try {
        const { category, amount, description, date } = req.body;

        const update = db.prepare(`
      UPDATE expenses 
      SET category = ?, amount = ?, description = ?, expense_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

        const result = update.run(
            category,
            amount,
            description || null,
            date,
            req.params.id
        );

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Expense not found' });
        }

        res.json({ message: 'Expense updated successfully' });
    } catch (error) {
        console.error('Error updating expense:', error);
        res.status(500).json({ error: 'Failed to update expense' });
    }
});

// Delete expense
router.delete('/:id', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const deleteExpense = db.prepare('DELETE FROM expenses WHERE id = ?');
        const result = deleteExpense.run(req.params.id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Expense not found' });
        }

        res.json({ message: 'Expense deleted successfully' });
    } catch (error) {
        console.error('Error deleting expense:', error);
        res.status(500).json({ error: 'Failed to delete expense' });
    }
});

export default router;
