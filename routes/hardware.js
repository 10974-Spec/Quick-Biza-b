import express from 'express';
import db from '../database/db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Register hardware device (printer, scanner, etc.)
router.post('/hardware', authenticateToken, (req, res) => {
    try {
        const { device_name, device_type, connection_type, ip_address } = req.body;

        if (!device_name || !device_type) {
            return res.status(400).json({ error: 'Device name and type are required' });
        }

        // Generate unique identifier for hardware device
        const deviceIdentifier = `hardware-${device_type}-${Date.now()}`;

        const result = db.prepare(`
            INSERT INTO devices (
                device_name, 
                device_identifier, 
                device_type, 
                device_category,
                connection_type,
                ip_address,
                user_id,
                status
            )
            VALUES (?, ?, ?, 'hardware', ?, ?, ?, 'active')
        `).run(
            device_name,
            deviceIdentifier,
            device_type,
            connection_type || 'unknown',
            ip_address || null,
            req.user.id
        );

        // Create notification for new hardware device
        db.prepare(`
            INSERT INTO notifications (user_id, title, message, type, action_url)
            VALUES (?, ?, ?, 'device', '/notifications')
        `).run(
            req.user.id,
            'New Device Connected',
            `${device_name} (${device_type}) has been connected to the system`
        );

        const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(result.lastInsertRowid);
        res.json(device);
    } catch (error) {
        console.error('Error registering hardware device:', error);
        res.status(500).json({ error: 'Failed to register hardware device', details: error.message });
    }
});

// Get all hardware devices
router.get('/hardware', authenticateToken, (req, res) => {
    try {
        const devices = db.prepare(`
            SELECT * FROM devices 
            WHERE device_category = 'hardware'
            ORDER BY last_active DESC
        `).all();

        res.json(devices);
    } catch (error) {
        console.error('Error fetching hardware devices:', error);
        res.status(500).json({ error: 'Failed to fetch hardware devices', details: error.message });
    }
});

// Test printer connection
router.post('/hardware/:id/test', authenticateToken, (req, res) => {
    try {
        const { id } = req.params;

        const device = db.prepare('SELECT * FROM devices WHERE id = ? AND device_category = \'hardware\'').get(id);

        if (!device) {
            return res.status(404).json({ error: 'Hardware device not found' });
        }

        // Update last_active to indicate test
        db.prepare('UPDATE devices SET last_active = CURRENT_TIMESTAMP WHERE id = ?').run(id);

        // In a real implementation, you would send a test print job here
        // For now, we'll just simulate success

        res.json({
            success: true,
            message: `Test successful for ${device.device_name}`,
            device
        });
    } catch (error) {
        console.error('Error testing hardware device:', error);
        res.status(500).json({ error: 'Failed to test hardware device', details: error.message });
    }
});

export default router;
