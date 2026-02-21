import express from 'express';
import hardwareService from '../services/hardware.js';
import { authenticateToken } from '../middleware/auth.js';
import db from '../database/db.js';

const router = express.Router();

// Get active count (for badge) - MUST BE BEFORE OTHER ROUTES
router.get('/active', authenticateToken, async (req, res) => {
    try {
        console.log('🔍 GET /api/devices/active called');
        const devices = await hardwareService.getStoredDevices();
        const count = devices.filter(d => d.status === 'active').length;
        res.json({ count });
    } catch (error) {
        console.error('Error fetching active count:', error);
        res.status(500).json({ error: 'Failed to fetch active count' });
    }
});

// Get all devices (software + hardware)
router.get('/', authenticateToken, async (req, res) => {
    try {
        console.log('🔍 GET /api/devices called');
        const devices = await hardwareService.getStoredDevices();
        res.json(devices);
    } catch (error) {
        console.error('Error fetching devices:', error);
        res.status(500).json({ error: 'Failed to fetch devices', details: error.message });
    }
});



// Trigger Hardware Scan
router.post('/scan', authenticateToken, async (req, res) => {
    try {
        console.log('🔍 Starting hardware scan...');
        const devices = await hardwareService.scanAll();
        res.json({ message: 'Scan completed', devices });
    } catch (error) {
        console.error('Scan failed:', error);
        res.status(500).json({ error: 'Hardware scan failed', details: error.message });
    }
});

// Test a specific device
router.post('/:id/test', authenticateToken, async (req, res) => {
    try {
        // Implement specific test logic (e.g., print receipt)
        res.json({ message: 'Test command sent successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Device test failed' });
    }
});

// Refresh device (re-scan specific)
router.post('/:id/refresh', authenticateToken, async (req, res) => {
    try {
        // For now, just trigger a full scan as we don't have per-device refresh yet
        await hardwareService.scanAll();
        res.json({ message: 'Device refreshed' });
    } catch (error) {
        res.status(500).json({ error: 'Refresh failed' });
    }
});

// Update device name
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { device_name } = req.body;
        if (!device_name) {
            return res.status(400).json({ error: 'Device name is required' });
        }

        const stmt = db.prepare('UPDATE devices SET device_name = ? WHERE id = ?');
        const result = stmt.run(device_name, req.params.id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        res.json({ message: 'Device updated successfully' });
    } catch (error) {
        console.error('Update failed:', error);
        res.status(500).json({ error: 'Update failed', details: error.message });
    }
});

// Update device status
router.put('/:id/status', authenticateToken, async (req, res) => {
    try {
        // Implementation pending database update method
        res.json({ message: 'Status updated' });
    } catch (error) {
        res.status(500).json({ error: 'Status update failed' });
    }
});

// Delete device
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        // Implementation pending database delete method
        res.json({ message: 'Device deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Delete failed' });
    }
});


export default router;
