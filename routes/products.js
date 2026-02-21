import express from 'express';
import db from '../database/db.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { syncRecord } from '../services/syncService.js';

const router = express.Router();

// Get all products
router.get('/', (req, res) => {
    try {
        const { search, category } = req.query;

        let query = `
      SELECT p.*, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.active = 1
    `;

        const params = [];

        if (search) {
            query += ' AND p.name LIKE ?';
            params.push(`%${search}%`);
        }

        if (category && category !== 'All') {
            query += ' AND c.name = ?';
            params.push(category);
        }

        query += ' ORDER BY p.name';

        const products = db.prepare(query).all(...params);

        // Get inventory for each product
        const productsWithInventory = products.map(product => {
            const inventory = db.prepare('SELECT quantity FROM inventory_finished WHERE product_id = ?').get(product.id);
            return {
                ...product,
                stock: inventory ? inventory.quantity : 0
            };
        });

        res.json(productsWithInventory);
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

// Get single product
router.get('/:id', (req, res) => {
    try {
        const product = db.prepare(`
      SELECT p.*, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = ?
    `).get(req.params.id);

        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // Get inventory
        const inventory = db.prepare('SELECT quantity FROM inventory_finished WHERE product_id = ?').get(product.id);

        // Get recipe
        const recipe = db.prepare(`
      SELECT r.*, i.name as ingredient_name, i.unit
      FROM recipes r
      JOIN ingredients i ON r.ingredient_id = i.id
      WHERE r.product_id = ?
    `).all(product.id);

        res.json({
            ...product,
            stock: inventory ? inventory.quantity : 0,
            recipe
        });
    } catch (error) {
        console.error('Error fetching product:', error);
        res.status(500).json({ error: 'Failed to fetch product' });
    }
});

// Create product (Manager/Admin only)
router.post('/', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
    try {
        const { name, category_id, price, barcode, emoji, description } = req.body;

        if (!name || !price) {
            return res.status(400).json({ error: 'Name and price are required' });
        }

        const result = db.prepare(`
      INSERT INTO products (name, category_id, price, barcode, emoji, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, category_id, price, barcode, emoji, description);

        // Initialize inventory for this product
        db.prepare('INSERT INTO inventory_finished (product_id, quantity) VALUES (?, ?)').run(result.lastInsertRowid, 0);

        // Real-time cloud sync
        syncRecord('products', result.lastInsertRowid).catch(() => { });

        res.status(201).json({ id: result.lastInsertRowid, message: 'Product created successfully' });
    } catch (error) {
        console.error('Error creating product:', error);
        res.status(500).json({ error: 'Failed to create product' });
    }
});

// Update product
router.put('/:id', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
    try {
        const { name, category_id, price, barcode, emoji, description } = req.body;

        db.prepare(`
      UPDATE products
      SET name = ?, category_id = ?, price = ?, barcode = ?, emoji = ?, description = ?
      WHERE id = ?
    `).run(name, category_id, price, barcode, emoji, description, req.params.id);

        // Real-time cloud sync
        syncRecord('products', req.params.id).catch(() => { });

        res.json({ message: 'Product updated successfully' });
    } catch (error) {
        console.error('Error updating product:', error);
        res.status(500).json({ error: 'Failed to update product' });
    }
});

// Delete product (Admin only)
router.delete('/:id', authenticateToken, requireRole('admin'), (req, res) => {
    try {
        db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
        res.json({ message: 'Product deleted successfully' });
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ error: 'Failed to delete product' });
    }
});

// Get all categories
router.get('/api/categories', (req, res) => {
    try {
        const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
        res.json(categories);
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

export default router;
