import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import db from '../database/db.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import os from 'os';

const router = express.Router();
const _settingsUploadBase = process.env.USER_DATA_PATH || path.join(os.homedir(), '.config', 'quickbiza');

// Configure storage for logo uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(_settingsUploadBase, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, 'logo-' + Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|svg/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error("Error: File upload only supports images (jpeg, jpg, png, svg)"));
    }
});

// GET /api/settings
router.get('/', (req, res) => {
    try {
        const settings = db.prepare('SELECT * FROM app_settings ORDER BY id DESC LIMIT 1').get();
        const company = db.prepare('SELECT name FROM company_profile LIMIT 1').get();

        res.json({
            ...(settings || {}),
            company_name: company ? company.name : 'Aroma Bakery'
        });
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

// POST /api/settings
router.post('/', (req, res) => {
    try {
        const { theme, primary_color, receipt_footer_text } = req.body;

        // Upsert settings
        const existing = db.prepare('SELECT id FROM app_settings ORDER BY id DESC LIMIT 1').get();

        if (existing) {
            db.prepare(`
                UPDATE app_settings 
                SET theme = COALESCE(?, theme), 
                    primary_color = COALESCE(?, primary_color),
                    receipt_footer_text = COALESCE(?, receipt_footer_text),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(theme, primary_color, receipt_footer_text, existing.id);
        } else {
            db.prepare(`
                INSERT INTO app_settings (theme, primary_color, receipt_footer_text)
                VALUES (?, ?, ?)
            `).run(theme || 'default', primary_color || '#ea580c', receipt_footer_text);
        }

        res.json({ success: true, message: 'Settings updated' });
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// POST /api/settings/logo
router.post('/logo', upload.single('logo'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Generate public URL path (assuming frontend/public or serving static files)
        // For development, we'll serve from backend static folder or copy to frontend public
        // Ideally, serve via express static
        const logoPath = `/uploads/${req.file.filename}`;

        // Update DB
        const existing = db.prepare('SELECT id FROM app_settings ORDER BY id DESC LIMIT 1').get();

        if (existing) {
            db.prepare('UPDATE app_settings SET logo_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(logoPath, existing.id);
        } else {
            db.prepare('INSERT INTO app_settings (logo_path) VALUES (?)').run(logoPath);
        }

        res.json({ success: true, logoPath });
    } catch (error) {
        console.error('Error uploading logo:', error);
        res.status(500).json({ error: 'Failed to upload logo' });
    }
});

export default router;
