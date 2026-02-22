import express from 'express';
import db from '../database/db.js';
import { authenticateToken } from '../middleware/auth.js';
import { syncRecord } from '../services/syncService.js';
import hardwareService from '../services/hardware.js';

const router = express.Router();

// Create a sale with automatic inventory deduction
router.post('/', authenticateToken, (req, res) => {
    const { items, discount_percent = 0, customer_id = null } = req.body;

    if (!items || items.length === 0) {
        return res.status(400).json({ error: 'No items in cart' });
    }

    try {
        // Start transaction
        const createSale = db.transaction((saleData) => {
            const { items, discount_percent, customer_id, cashier_id } = saleData;

            // Calculate totals
            let subtotal = 0;
            const saleItems = [];

            for (const item of items) {
                const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.id);
                if (!product) {
                    throw new Error(`Product ${item.id} not found`);
                }

                // Check stock availability
                const inventory = db.prepare('SELECT quantity FROM inventory_finished WHERE product_id = ?').get(item.id);
                if (!inventory || inventory.quantity < item.qty) {
                    throw new Error(`Insufficient stock for ${product.name}. Available: ${inventory?.quantity || 0}, Required: ${item.qty}`);
                }

                const itemSubtotal = product.price * item.qty;
                subtotal += itemSubtotal;

                saleItems.push({
                    product_id: product.id,
                    product_name: product.name,
                    quantity: item.qty,
                    unit_price: product.price,
                    subtotal: itemSubtotal
                });
            }

            const discount_amount = subtotal * (discount_percent / 100);
            const total = subtotal - discount_amount;

            // Insert sale
            const saleResult = db.prepare(`
        INSERT INTO sales (customer_id, subtotal, discount_percent, discount_amount, total, cashier_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(customer_id, subtotal, discount_percent, discount_amount, total, cashier_id);

            const saleId = saleResult.lastInsertRowid;

            // Insert sale items and deduct inventory
            for (const saleItem of saleItems) {
                // Insert sale item
                db.prepare(`
          INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, subtotal)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(saleId, saleItem.product_id, saleItem.product_name, saleItem.quantity, saleItem.unit_price, saleItem.subtotal);

                // Deduct finished goods inventory
                const currentInventory = db.prepare('SELECT quantity FROM inventory_finished WHERE product_id = ?').get(saleItem.product_id);
                const newQuantity = currentInventory.quantity - saleItem.quantity;

                db.prepare('UPDATE inventory_finished SET quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?')
                    .run(newQuantity, saleItem.product_id);

                // Log inventory movement
                db.prepare(`
          INSERT INTO inventory_logs (type, item_id, movement_type, quantity_change, quantity_after, reference_id, reference_type, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run('finished', saleItem.product_id, 'sale', -saleItem.quantity, newQuantity, saleId, 'sale', cashier_id);

                // Deduct raw materials based on recipe
                const recipeItems = db.prepare('SELECT ingredient_id, quantity_required FROM recipes WHERE product_id = ?').all(saleItem.product_id);

                for (const recipeItem of recipeItems) {
                    const totalIngredientNeeded = recipeItem.quantity_required * saleItem.quantity;
                    const currentRawInventory = db.prepare('SELECT quantity FROM inventory_raw WHERE ingredient_id = ?').get(recipeItem.ingredient_id);

                    if (currentRawInventory) {
                        const newRawQuantity = currentRawInventory.quantity - totalIngredientNeeded;

                        db.prepare('UPDATE inventory_raw SET quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE ingredient_id = ?')
                            .run(newRawQuantity, recipeItem.ingredient_id);

                        // Log raw material movement
                        db.prepare(`
              INSERT INTO inventory_logs (type, item_id, movement_type, quantity_change, quantity_after, reference_id, reference_type, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run('raw', recipeItem.ingredient_id, 'sale', -totalIngredientNeeded, newRawQuantity, saleId, 'sale', cashier_id);
                    }
                }
            }

            return { saleId, subtotal, discount_amount, total };
        });

        const result = createSale({ items, discount_percent, customer_id, cashier_id: req.user.id });

        res.status(201).json({
            success: true,
            sale_id: result.saleId,
            subtotal: result.subtotal,
            discount_amount: result.discount_amount,
            total: result.total,
            message: 'Sale completed successfully'
        });

        // 🖨️ Fire-and-forget receipt print (does nothing if no printer connected)
        setImmediate(async () => {
            try {
                const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(result.saleId);
                const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(result.saleId);
                if (sale) await hardwareService.printReceipt(sale, items);
            } catch (err) {
                console.warn('🖨️ Receipt print skipped:', err.message);
            }
        });

        // ☁️ Real-time cloud sync (fire-and-forget)
        syncRecord('sales', result.saleId).catch(() => { });

    } catch (error) {
        console.error('Error creating sale:', error);
        res.status(500).json({ error: error.message || 'Failed to create sale' });
    }
});

// Get all sales
router.get('/', authenticateToken, (req, res) => {
    try {
        const { start_date, end_date, limit = 50 } = req.query;
        const companyId = req.user?.company_id || 1;

        let query = `
      SELECT s.*, u.full_name as cashier_name, c.name as customer_name
      FROM sales s
      LEFT JOIN users u ON s.cashier_id = u.id
      LEFT JOIN customers c ON s.customer_id = c.id
      WHERE u.company_id = ?
    `;

        const params = [companyId];

        if (start_date) {
            query += ' AND DATE(s.created_at) >= ?';
            params.push(start_date);
        }

        if (end_date) {
            query += ' AND DATE(s.created_at) <= ?';
            params.push(end_date);
        }

        query += ' ORDER BY s.created_at DESC LIMIT ?';
        params.push(parseInt(limit));

        const sales = db.prepare(query).all(...params);
        res.json(sales);
    } catch (error) {
        console.error('Error fetching sales:', error);
        res.status(500).json({ error: 'Failed to fetch sales' });
    }
});

// Get single sale with items
router.get('/:id', authenticateToken, (req, res) => {
    try {
        const companyId = req.user?.company_id || 1;
        const sale = db.prepare(`
      SELECT s.*, u.full_name as cashier_name, c.name as customer_name
      FROM sales s
      LEFT JOIN users u ON s.cashier_id = u.id
      LEFT JOIN customers c ON s.customer_id = c.id
      WHERE s.id = ? AND u.company_id = ?
    `).get(req.params.id, companyId);

        if (!sale) {
            return res.status(404).json({ error: 'Sale not found' });
        }

        const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(req.params.id);
        const payments = db.prepare('SELECT * FROM payments WHERE sale_id = ?').all(req.params.id);

        res.json({ ...sale, items, payments });
    } catch (error) {
        console.error('Error fetching sale:', error);
        res.status(500).json({ error: 'Failed to fetch sale' });
    }
});

// Get today's sales summary
router.get('/summary/today', authenticateToken, (req, res) => {
    try {
        const companyId = req.user?.company_id || 1;
        const summary = db.prepare(`
      SELECT 
        COUNT(*) as total_sales,
        COALESCE(SUM(s.total), 0) as total_revenue,
        COALESCE(SUM(s.discount_amount), 0) as total_discounts
      FROM sales s
      JOIN users u ON s.cashier_id = u.id
      WHERE DATE(s.created_at) = DATE('now')
      AND s.status = 'completed'
      AND u.company_id = ?
    `).get(companyId);

        // Payment breakdown
        const paymentBreakdown = db.prepare(`
      SELECT 
        p.method,
        COUNT(*) as count,
        COALESCE(SUM(p.amount), 0) as total
      FROM payments p
      JOIN sales s ON p.sale_id = s.id
      JOIN users u ON s.cashier_id = u.id
      WHERE DATE(s.created_at) = DATE('now')
      AND p.status = 'completed'
      AND u.company_id = ?
      GROUP BY p.method
    `).all(companyId);

        res.json({ ...summary, payment_breakdown: paymentBreakdown });
    } catch (error) {
        console.error('Error fetching sales summary:', error);
        res.status(500).json({ error: 'Failed to fetch sales summary' });
    }
});

export default router;
