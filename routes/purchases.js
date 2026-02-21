import express from 'express';
import db from '../database/db.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
const router = express.Router();

// Get all purchases
router.get('/', authenticateToken, (req, res) => {
    try {
        const { status, supplier_id, limit = 50, offset = 0 } = req.query;

        let query = `
      SELECT p.*, s.name as supplier_name, u.full_name as created_by_name
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN users u ON p.created_by = u.id
      WHERE 1=1
    `;
        const params = [];

        if (status) {
            query += ' AND p.payment_status = ?';
            params.push(status);
        }

        if (supplier_id) {
            query += ' AND p.supplier_id = ?';
            params.push(supplier_id);
        }

        query += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const purchases = db.prepare(query).all(...params);
        res.json(purchases);
    } catch (error) {
        console.error('Error fetching purchases:', error);
        res.status(500).json({ error: 'Failed to fetch purchases' });
    }
});

// Get single purchase
router.get('/:id', authenticateToken, (req, res) => {
    try {
        const purchase = db.prepare(`
      SELECT p.*, s.name as supplier_name, s.phone as supplier_phone,
             u.full_name as created_by_name
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN users u ON p.created_by = u.id
      WHERE p.id = ?
    `).get(req.params.id);

        if (!purchase) {
            return res.status(404).json({ error: 'Purchase not found' });
        }

        res.json(purchase);
    } catch (error) {
        console.error('Error fetching purchase:', error);
        res.status(500).json({ error: 'Failed to fetch purchase' });
    }
});

// Create purchase
router.post('/', authenticateToken, requireRole('manager', 'admin'), (req, res) => {
    try {
        const { supplier_id, items, total_amount, notes } = req.body;

        if (!supplier_id || !items || !total_amount) {
            console.error('Missing fields:', { supplier_id, hasItems: !!items, total_amount });
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate items is an array
        let purchaseItems = items;
        if (typeof items === 'string') {
            try {
                purchaseItems = JSON.parse(items);
            } catch (e) {
                console.error('Failed to parse items string:', e);
                return res.status(400).json({
                    error: 'Invalid items format',
                    details: 'Items must be a valid JSON string or array'
                });
            }
        }

        console.log('Creating purchase with:', { supplier_id, total_amount, itemsCount: purchaseItems.length });

        // Start a transaction
        const createPurchaseTransaction = db.transaction(() => {
            try {
                const initialPayment = req.body.amount_paid ? parseFloat(req.body.amount_paid) : 0;
                const paymentMethod = req.body.payment_method || 'cash';

                // Determine status
                let status = 'pending';
                if (initialPayment >= total_amount) status = 'paid';
                else if (initialPayment > 0) status = 'partial';

                console.log('Inserting purchase record...');
                const insertPurchase = db.prepare(`
                    INSERT INTO purchases (supplier_id, total_amount, payment_status, amount_paid, created_by)
                    VALUES (?, ?, ?, ?, ?)
                `);

                const result = insertPurchase.run(
                    supplier_id,
                    total_amount,
                    status,
                    initialPayment,
                    req.user.id
                );

                const purchaseId = result.lastInsertRowid;
                console.log('Purchase inserted, ID:', purchaseId);

                // Insert initial payment record if valid
                if (initialPayment > 0) {
                    const insertPayment = db.prepare(`
                        INSERT INTO purchase_payments (purchase_id, amount, method, notes, recorded_by)
                        VALUES (?, ?, ?, 'Initial payment', ?)
                    `);
                    insertPayment.run(purchaseId, initialPayment, paymentMethod, req.user.id);
                }

                const insertItem = db.prepare(`
                    INSERT INTO purchase_items (purchase_id, ingredient_id, quantity, unit_cost, subtotal)
                    VALUES (?, ?, ?, ?, ?)
                `);

                // Update raw inventory since we bought ingredients
                const updateInventory = db.prepare(`
                    UPDATE inventory_raw 
                    SET quantity = quantity + ?, last_updated = CURRENT_TIMESTAMP 
                    WHERE ingredient_id = ?
                `);

                // If inventory record doesn't exist, insert it
                const checkInventory = db.prepare('SELECT id FROM inventory_raw WHERE ingredient_id = ?');
                const insertInventory = db.prepare('INSERT INTO inventory_raw (ingredient_id, quantity) VALUES (?, ?)');

                for (const item of purchaseItems) {
                    // item structure: { ingredient_id, quantity, unit_cost }
                    // Calculate subtotal if not provided
                    const subtotal = item.subtotal || (item.quantity * item.unit_cost);

                    insertItem.run(
                        purchaseId,
                        item.ingredient_id,
                        item.quantity,
                        item.unit_cost,
                        subtotal
                    );

                    // Update inventory
                    const invExists = checkInventory.get(item.ingredient_id);
                    if (invExists) {
                        updateInventory.run(item.quantity, item.ingredient_id);
                    } else {
                        insertInventory.run(item.ingredient_id, item.quantity);
                    }
                }

                return purchaseId;
            } catch (err) {
                console.error('Transaction failed:', err);
                if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
                    throw new Error('Invalid supplier or user ID');
                }
                throw err;
            }
        });

        const purchaseId = createPurchaseTransaction();

        res.status(201).json({
            message: 'Purchase order created successfully',
            purchase_id: purchaseId
        });
    } catch (error) {
        console.error('Error creating purchase:', error);
        if (error.message === 'Invalid supplier or user ID') {
            return res.status(400).json({ error: 'Invalid supplier selected' });
        }
        res.status(500).json({ error: 'Failed to create purchase', details: error.message });
    }
});

// Get purchase payments
router.get('/:id/payments', authenticateToken, (req, res) => {
    try {
        const payments = db.prepare(`
            SELECT pp.*, u.full_name as recorded_by_name
            FROM purchase_payments pp
            LEFT JOIN users u ON pp.recorded_by = u.id
            WHERE pp.purchase_id = ?
            ORDER BY pp.paid_at DESC
        `).all(req.params.id);
        res.json(payments);
    } catch (error) {
        console.error('Error fetching purchase payments:', error);
        res.status(500).json({ error: 'Failed to fetch payments' });
    }
});

// Add payment to purchase
router.post('/:id/payments', authenticateToken, requireRole('manager', 'admin'), (req, res) => {
    try {
        const { amount, method, notes, reference } = req.body;
        const purchaseId = req.params.id;

        if (!amount || !method) {
            return res.status(400).json({ error: 'Amount and payment method are required' });
        }

        const addPaymentTransaction = db.transaction(() => {
            // Get current purchase state
            const purchase = db.prepare('SELECT total_amount, amount_paid FROM purchases WHERE id = ?').get(purchaseId);
            if (!purchase) throw new Error('Purchase not found');

            const newAmountPaid = (purchase.amount_paid || 0) + parseFloat(amount);

            // Determine new status
            let status = 'pending';
            if (newAmountPaid >= purchase.total_amount) status = 'paid';
            else if (newAmountPaid > 0) status = 'partial';

            // Insert payment record
            db.prepare(`
                INSERT INTO purchase_payments (purchase_id, amount, method, reference, notes, recorded_by)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(purchaseId, amount, method, reference, notes, req.user.id);

            // Update purchase record
            db.prepare(`
                UPDATE purchases 
                SET amount_paid = ?, payment_status = ?
                WHERE id = ?
            `).run(newAmountPaid, status, purchaseId);

            return { newAmountPaid, status };
        });

        const result = addPaymentTransaction();
        res.json(result);
    } catch (error) {
        console.error('Error adding payment:', error);
        res.status(500).json({ error: error.message || 'Failed to add payment' });
    }
});

// Update purchase status
router.patch('/:id/status', authenticateToken, requireRole('manager', 'admin'), (req, res) => {
    try {
        const { status } = req.body;
        const validStatuses = ['pending', 'received', 'cancelled'];

        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const update = db.prepare('UPDATE purchases SET payment_status = ? WHERE id = ?');
        const result = update.run(status, req.params.id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Purchase not found' });
        }

        res.json({ message: 'Purchase status updated successfully' });
    } catch (error) {
        console.error('Error updating purchase status:', error);
        res.status(500).json({ error: 'Failed to update purchase status' });
    }
});

// Delete purchase
router.delete('/:id', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        const deletePurchase = db.prepare('DELETE FROM purchases WHERE id = ?');
        const result = deletePurchase.run(req.params.id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Purchase not found' });
        }

        res.json({ message: 'Purchase deleted successfully' });
    } catch (error) {
        console.error('Error deleting purchase:', error);
        res.status(500).json({ error: 'Failed to delete purchase' });
    }
});

export default router;
