
import express from 'express';
import db from '../database/db.js';

const router = express.Router();

// GET /api/roles - List all roles
router.get('/', (req, res) => {
    try {
        const roles = db.prepare('SELECT * FROM roles ORDER BY name').all();
        res.json(roles);
    } catch (error) {
        console.error('Error fetching roles:', error);
        res.status(500).json({ error: 'Failed to fetch roles' });
    }
});

// POST /api/roles - Create new role
router.post('/', (req, res) => {
    try {
        const { name, permissions } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Role name is required' });
        }

        const stmt = db.prepare('INSERT INTO roles (name, permissions) VALUES (?, ?)');
        const info = stmt.run(name, JSON.stringify(permissions || []));

        res.status(201).json({ id: info.lastInsertRowid, name, permissions });
    } catch (error) {
        console.error('Error creating role:', error);
        res.status(500).json({ error: 'Failed to create role' });
    }
});

// DELETE /api/roles/:id - Delete role
router.delete('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(id);

        if (!role) {
            return res.status(404).json({ error: 'Role not found' });
        }

        if (role.is_system) {
            return res.status(403).json({ error: 'Cannot delete system roles' });
        }

        db.prepare('DELETE FROM roles WHERE id = ?').run(id);
        res.json({ message: 'Role deleted successfully' });
    } catch (error) {
        console.error('Error deleting role:', error);
        res.status(500).json({ error: 'Failed to delete role' });
    }
});

export default router;
