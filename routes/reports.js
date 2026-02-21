import express from 'express';
import db from '../database/db.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import hardwareService from '../services/hardware.js';

const router = express.Router();

// Sales Report
router.get('/sales', authenticateToken, (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        // Check if sales table has data
        const hasData = db.prepare('SELECT COUNT(*) as count FROM sales').get();

        if (!hasData || hasData.count === 0) {
            return res.json({
                data: [],
                totals: { total_sales: 0, total_transactions: 0, avg_transaction: 0 }
            });
        }

        let query = `
            SELECT 
                DATE(s.created_at) as date,
                COUNT(s.id) as total_transactions,
                COALESCE(SUM(s.total), 0) as total_sales,
                COALESCE(SUM(s.total - s.discount_amount), 0) as net_sales,
                COALESCE(AVG(s.total), 0) as avg_transaction
            FROM sales s
        `;

        const params = [];
        if (start_date && end_date) {
            query += ` WHERE DATE(s.created_at) BETWEEN ? AND ?`;
            params.push(start_date, end_date);
        }

        query += ` GROUP BY DATE(s.created_at) ORDER BY date DESC`;

        const salesData = db.prepare(query).all(...params);

        // Calculate totals
        const totals = {
            total_sales: salesData.reduce((sum, row) => sum + (row.total_sales || 0), 0),
            total_transactions: salesData.reduce((sum, row) => sum + (row.total_transactions || 0), 0),
            avg_transaction: salesData.length > 0
                ? salesData.reduce((sum, row) => sum + (row.avg_transaction || 0), 0) / salesData.length
                : 0,
        };

        res.json({ data: salesData, totals });
    } catch (error) {
        console.error('Error generating sales report:', error);
        res.status(500).json({ error: 'Failed to generate sales report', details: error.message });
    }
});

// Inventory Report
router.get('/inventory', authenticateToken, (req, res) => {
    try {
        const inventory = db.prepare(`
            SELECT 
                p.id,
                p.name,
                p.price,
                c.name as category,
                COALESCE(i.quantity, 0) as stock_level,
                COALESCE(i.quantity, 0) * p.price as stock_value
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN inventory_finished i ON p.id = i.product_id
            WHERE p.active = 1
            ORDER BY stock_value DESC
        `).all();

        const totals = {
            total_products: inventory.length,
            total_stock_value: inventory.reduce((sum, item) => sum + (item.stock_value || 0), 0),
            low_stock_items: inventory.filter(item => item.stock_level < 10).length,
        };

        res.json({ data: inventory, totals });
    } catch (error) {
        console.error('Error generating inventory report:', error);
        res.status(500).json({ error: 'Failed to generate inventory report', details: error.message });
    }
});

// Financial Report
router.get('/financial', authenticateToken, requireRole('manager', 'admin'), (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        const params = [];
        let dateFilter = '';
        if (start_date && end_date) {
            dateFilter = ` WHERE DATE(created_at) BETWEEN ? AND ?`;
            params.push(start_date, end_date);
        }

        // Get total sales
        const salesQuery = `SELECT COALESCE(SUM(total), 0) as total FROM sales${dateFilter}`;
        const sales = db.prepare(salesQuery).get(...params);

        // Get total expenses (use 'expense_date' column for expenses table)
        const expensesDateFilter = start_date && end_date ? ` WHERE DATE(expense_date) BETWEEN ? AND ?` : '';
        const expensesQuery = `SELECT COALESCE(SUM(amount), 0) as total FROM expenses${expensesDateFilter}`;
        const expenses = db.prepare(expensesQuery).get(...params);

        // Get total purchases
        const purchasesQuery = `SELECT COALESCE(SUM(total_amount), 0) as total FROM purchases${dateFilter}`;
        const purchases = db.prepare(purchasesQuery).get(...params);

        const revenue = sales.total || 0;
        const totalExpenses = (expenses.total || 0) + (purchases.total || 0);
        const grossProfit = revenue - (purchases.total || 0);
        const netProfit = revenue - totalExpenses;

        res.json({
            revenue,
            cost_of_goods: purchases.total || 0,
            gross_profit: grossProfit,
            operating_expenses: expenses.total || 0,
            net_profit: netProfit,
            profit_margin: revenue > 0 ? ((netProfit / revenue) * 100).toFixed(2) : 0,
        });
    } catch (error) {
        console.error('Error generating financial report:', error);
        res.status(500).json({ error: 'Failed to generate financial report', details: error.message });
    }
});

// Product Performance Report
router.get('/products', authenticateToken, (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        let query = `
            SELECT 
                p.id,
                p.name,
                p.price,
                c.name as category,
                COUNT(si.id) as times_sold,
                SUM(si.quantity) as total_quantity,
                SUM(si.subtotal) as total_revenue
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN sale_items si ON p.id = si.product_id
            LEFT JOIN sales s ON si.sale_id = s.id
        `;

        const params = [];
        if (start_date && end_date) {
            query += ` WHERE DATE(s.created_at) BETWEEN ? AND ?`;
            params.push(start_date, end_date);
        }

        query += ` GROUP BY p.id ORDER BY total_revenue DESC`;

        const products = db.prepare(query).all(...params);

        res.json({ data: products });
    } catch (error) {
        console.error('Error generating product performance report:', error);
        res.status(500).json({ error: 'Failed to generate product performance report', details: error.message });
    }
});

// Customer Analytics Report
router.get('/customers', authenticateToken, (req, res) => {
    try {
        // Check if customers table has data
        const customerCount = db.prepare('SELECT COUNT(*) as count FROM customers').get();

        if (!customerCount || customerCount.count === 0) {
            return res.json({
                data: [],
                totals: { total_customers: 0, total_loyalty_points: 0, avg_purchase: 0 }
            });
        }

        const customers = db.prepare(`
            SELECT 
                c.id,
                c.name,
                c.phone,
                COALESCE(c.loyalty_points, 0) as loyalty_points,
                COALESCE(SUM(s.total), 0) as total_spent,
                MAX(s.created_at) as last_purchase
            FROM customers c
            LEFT JOIN sales s ON c.id = s.customer_id
            GROUP BY c.id
            ORDER BY total_spent DESC
            LIMIT 100
        `).all();

        const totals = {
            total_customers: customerCount.count,
            total_loyalty_points: customers.reduce((sum, c) => sum + (c.loyalty_points || 0), 0),
            avg_purchase: customers.length > 0
                ? customers.reduce((sum, c) => sum + (c.total_spent || 0), 0) / customers.length
                : 0,
        };

        res.json({ data: customers, totals });
    } catch (error) {
        console.error('Error generating customer analytics:', error);
        res.status(500).json({ error: 'Failed to generate customer analytics', details: error.message });
    }
});

// Expense Analysis Report
router.get('/expenses', authenticateToken, (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        let query = `
            SELECT 
                category,
                COUNT(*) as count,
                SUM(amount) as total,
                AVG(amount) as average
            FROM expenses
        `;

        const params = [];
        if (start_date && end_date) {
            query += ` WHERE DATE(expense_date) BETWEEN ? AND ?`;
            params.push(start_date, end_date);
        }

        query += ` GROUP BY category ORDER BY total DESC`;

        const expenses = db.prepare(query).all(...params);

        const totalExpenses = expenses.reduce((sum, e) => sum + (e.total || 0), 0);

        const data = expenses.map(e => ({
            ...e,
            percentage: totalExpenses > 0 ? ((e.total / totalExpenses) * 100).toFixed(2) : 0,
        }));

        res.json({ data, total: totalExpenses });
    } catch (error) {
        console.error('Error generating expense analysis:', error);
        res.status(500).json({ error: 'Failed to generate expense analysis', details: error.message });
    }
});


// Print report
router.post('/print', authenticateToken, async (req, res) => {
    try {
        const { reportType, reportData } = req.body;

        if (!reportType || !reportData) {
            return res.status(400).json({ error: 'Report type and data are required' });
        }

        hardwareService.printReport(reportType, reportData);
        res.json({ success: true, message: 'Print job initiated' });

    } catch (error) {
        console.error('Error printing report:', error);
        res.status(500).json({ error: 'Failed to print report' });
    }
});

export default router;
