import express from 'express';
import db from '../database/db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all notifications for current user
router.get('/', authenticateToken, (req, res) => {
    try {
        // Add id DESC to break ties in created_at, ensuring stable order
        const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50').all(req.user.id);

        res.json(notifications);
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ error: 'Failed to fetch notifications', details: error.message });
    }
});

// Get unread notification count
router.get('/unread', authenticateToken, (req, res) => {
    try {
        const result = db.prepare(`
            SELECT COUNT(*) as count 
            FROM notifications 
            WHERE user_id = ? AND is_read = 0
        `).get(req.user.id);

        res.json({ count: result.count });
    } catch (error) {
        console.error('Error fetching unread count:', error);
        res.status(500).json({ error: 'Failed to fetch unread count', details: error.message });
    }
});

// Mark notification as read
router.put('/:id/read', authenticateToken, (req, res) => {
    try {
        const { id } = req.params;

        const result = db.prepare(`
            UPDATE notifications 
            SET is_read = 1 
            WHERE id = ? AND user_id = ?
        `).run(id, req.user.id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        res.json({ message: 'Notification marked as read' });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ error: 'Failed to mark notification as read', details: error.message });
    }
});

// Mark all notifications as read
router.put('/read-all', authenticateToken, (req, res) => {
    try {
        db.prepare(`
            UPDATE notifications 
            SET is_read = 1 
            WHERE user_id = ?
        `).run(req.user.id);

        res.json({ message: 'All notifications marked as read' });
    } catch (error) {
        console.error('Error marking all as read:', error);
        res.status(500).json({ error: 'Failed to mark all as read', details: error.message });
    }
});

// Delete notification
router.delete('/:id', authenticateToken, (req, res) => {
    try {
        const { id } = req.params;

        const result = db.prepare(`
            DELETE FROM notifications 
            WHERE id = ? AND user_id = ?
        `).run(id, req.user.id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        res.json({ message: 'Notification deleted' });
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ error: 'Failed to delete notification', details: error.message });
    }
});

// Create test notification (for testing purposes)
router.post('/test', authenticateToken, (req, res) => {
    try {
        const testNotifications = [
            {
                title: 'Low Stock Alert',
                message: 'White Bread stock is running low (5 units remaining)',
                type: 'warning'
            },
            {
                title: 'New Order Received',
                message: 'Custom cake order #45 has been placed by John Doe',
                type: 'info'
            },
            {
                title: 'Payment Confirmed',
                message: 'KES 15,000 payment received for Order #123',
                type: 'success'
            },
            {
                title: 'System Error',
                message: 'Failed to sync inventory data. Please check connection.',
                type: 'error'
            },
            {
                title: 'New Device Connected',
                message: 'Thermal Printer (USB) has been connected to the system',
                type: 'device'
            }
        ];

        // Pick a random notification
        const randomNotif = testNotifications[Math.floor(Math.random() * testNotifications.length)];

        const result = db.prepare(`
            INSERT INTO notifications (user_id, title, message, type, action_url)
            VALUES (?, ?, ?, ?, '/notifications')
        `).run(req.user.id, randomNotif.title, randomNotif.message, randomNotif.type);

        const notification = db.prepare('SELECT * FROM notifications WHERE id = ?').get(result.lastInsertRowid);

        res.json({
            message: 'Test notification created!',
            notification
        });
    } catch (error) {
        console.error('Error creating test notification:', error);
        res.status(500).json({ error: 'Failed to create test notification', details: error.message });
    }
});

export default router;
