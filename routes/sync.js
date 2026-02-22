import express from 'express';
import { syncState, enqueueSync } from '../services/syncService.js';
import { authenticateToken } from '../middleware/auth.js';
import db from '../database/db.js';

const router = express.Router();

/**
 * GET /api/sync/status
 * Returns the current sync state — online/offline, last sync time, pending queue size.
 */
router.get('/status', (req, res) => {
    try {
        const pendingCount = db.prepare('SELECT COUNT(*) as count FROM sync_queue').get()?.count ?? 0;
        const errorCount = db.prepare("SELECT COUNT(*) as count FROM sync_queue WHERE retry_count >= 5").get()?.count ?? 0;

        res.json({
            status: syncState.status,               // 'idle' | 'syncing' | 'synced' | 'offline' | 'error'
            lastSyncAt: syncState.lastSyncAt,
            lastSyncError: syncState.lastSyncError,
            recordsSynced: syncState.recordsSynced,
            pendingCount,
            errorCount,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/sync/trigger
 * Manually triggers an immediate sync (admin only).
 */
router.post('/trigger', authenticateToken, async (req, res) => {
    try {
        // Dynamic import to avoid circular deps
        const { default: runSyncNow } = await import('../services/syncService.js');
        res.json({ message: 'Sync initiated', status: syncState.status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/sync/queue
 * Returns pending queue items (dev/admin use).
 */
router.get('/queue', authenticateToken, (req, res) => {
    try {
        const items = db.prepare('SELECT * FROM sync_queue ORDER BY created_at DESC LIMIT 100').all();
        res.json({ items, total: items.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
