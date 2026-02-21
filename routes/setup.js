import express from 'express';
import { companyService } from '../services/companyService.js';
import { licenseService } from '../services/licenseService.js';
import db from '../database/db.js';
import bcrypt from 'bcrypt';

const router = express.Router();

// Check setup status
router.get('/status', (req, res) => {
    try {
        const isSetup = companyService.isSetup();
        res.json({ isSetup });
    } catch (error) {
        console.error('Setup status check failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create Company Profile (Hybrid: Cloud + Local)
// Create Company Profile (Hybrid: Cloud + Local)
router.post('/company', async (req, res) => {
    try {
        const companyData = req.body;
        console.log("🚀 Starting Company Registration (Hybrid Flow)...");

        // 1. Cloud Registration (Company + License)
        let cloudCompany = null;
        let cloudLicense = null;

        try {
            const { Company, License } = await import('../database/cloud.js');

            // A. Company
            cloudCompany = await Company.findOne({ email: companyData.email });
            if (!cloudCompany) {
                cloudCompany = new Company({
                    name: companyData.name,
                    business_type: companyData.business_type,
                    email: companyData.email,
                    phone: companyData.phone,
                    address: companyData.address,
                    logo_url: companyData.logo_path,
                    primary_color: companyData.primary_color,
                    theme_preference: companyData.theme
                });
                await cloudCompany.save();
                console.log("✅ Cloud Company Created:", cloudCompany._id);
            }

            // B. License
            // Check if license exists for this company
            cloudLicense = await License.findOne({ company_id: cloudCompany._id });

            if (!cloudLicense) {
                // Generate Trial License
                const licenseKey = `AROMA-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
                const expiry = new Date();
                expiry.setDate(expiry.getDate() + 14); // 14 Day Trial

                cloudLicense = new License({
                    company_id: cloudCompany._id,
                    license_key: licenseKey,
                    plan_type: 'trial',
                    status: 'expired',
                    issued_at: new Date(),
                    expires_at: expiry,
                    max_users: 2,
                    max_devices: 1,
                    modules_enabled: ['pos', 'inventory', 'reports']
                });
                await cloudLicense.save();
                console.log("✅ Cloud License Generated:", cloudLicense.license_key);
            }

        } catch (cloudError) {
            console.error("❌ Cloud Registration Failed:", cloudError.message);
            // REQUIRE Internet for Setup? Use flag or fail.
            // For now, return 503 if Cloud fails, as strict hybrid setup requires specific Cloud ID/License.
            if (cloudError.name === 'ValidationError') {
                return res.status(400).json({ error: cloudError.message });
            }
            return res.status(503).json({ error: "Internet connection required for initial setup." });
        }

        // 2. Local Initialization (Offline Engine)
        // Store the authoritative data returned from Cloud

        // Sync Company
        const company = companyService.createCompany({
            ...companyData,
            // cloud_id: cloudCompany._id // (If schema supported it)
        });

        // Sync License
        db.prepare('DELETE FROM license_store').run();
        db.prepare(`
            INSERT INTO license_store (license_key, issue_date, expiry_date, status, modules_enabled, last_verified_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(
            cloudLicense.license_key,
            cloudLicense.issued_at.toISOString(),
            cloudLicense.expires_at.toISOString(),
            cloudLicense.status,
            JSON.stringify(cloudLicense.modules_enabled)
        );
        console.log("💾 Local SQLite seeded with Cloud Data");

        res.json({
            success: true,
            company,
            cloud_id: cloudCompany._id,
            license: {
                key: cloudLicense.license_key,
                expiry: cloudLicense.expires_at
            }
        });

    } catch (error) {
        console.error('Company creation failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get License Details
router.get('/license', (req, res) => {
    try {
        const details = licenseService.getLicenseDetails();
        if (!details) return res.status(404).json({ error: 'No license found' });

        // Parse modules if string
        if (typeof details.modules_enabled === 'string') {
            try {
                details.modules_enabled = JSON.parse(details.modules_enabled);
            } catch (e) {
                console.error('Failed to parse modules_enabled:', e);
                details.modules_enabled = []; // Fallback to empty
            }
        }

        res.json(details);
    } catch (error) {
        console.error('Failed to get license details:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Activate License
router.post('/license', async (req, res) => {
    try {
        const { key } = req.body;
        if (!key) return res.status(400).json({ error: 'License key required' });

        const result = await licenseService.activateLicense(key);
        res.json(result);
    } catch (error) {
        console.error('License activation failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create Admin User (during setup)
router.post('/admin', async (req, res) => {
    try {
        const { username, password, fullName } = req.body;

        // Verify no users exist or only verify if setup is actually in progress (simplified for now)
        const userCount = db.prepare('SELECT count(*) as count FROM users').get();
        // If users exist, ensure request is authorized or part of a reset flow. 
        // For this SaaS setup wizard, we assume it runs on fresh installs.
        // But to be safe, if users exist, we might block this or require a special token.
        // For "Offline-First SaaS" fresh install, user table is seeded with default admin. 
        // We might want to UPDATE the default admin or create a new one.

        // Check if username already exists
        const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);

        if (existingUser) {
            // If we are updating the default admin, that's fine. 
            // But if we are creating a NEW admin and the name is taken, reject it.
            if (username !== 'admin') {
                return res.status(400).json({ error: 'Username already exists' });
            }
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        if (userCount.count > 0 && username === 'admin') {
            // Update default admin
            db.prepare(`
                UPDATE users SET password_hash = ?, full_name = ? WHERE username = 'admin'
             `).run(hashedPassword, fullName);
            res.json({ success: true, message: 'Admin updated' });
        } else {
            // Create new
            const result = db.prepare(`
                INSERT INTO users (username, password_hash, full_name, role, status, company_id)
                VALUES (?, ?, ?, 'admin', 'approved', 1)
            `).run(username, hashedPassword, fullName);
            res.json({ success: true, userId: result.lastInsertRowid });
        }
    } catch (error) {
        console.error('Admin creation failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Upgrade License (Add Module)
router.post('/license/upgrade', async (req, res) => {
    try {
        const { module } = req.body;
        if (!module) return res.status(400).json({ error: 'Module name required' });

        const currentLicense = licenseService.getLicenseDetails();
        if (!currentLicense) return res.status(404).json({ error: 'No active license found' });

        let modules = [];
        try {
            modules = JSON.parse(currentLicense.modules_enabled || '[]');
        } catch (e) {
            modules = [];
        }

        if (modules.includes(module)) {
            return res.json({ success: true, message: 'Module already enabled' });
        }

        modules.push(module);

        // Update DB
        db.prepare('UPDATE license_store SET modules_enabled = ? WHERE id = ?')
            .run(JSON.stringify(modules), currentLicense.id);

        console.log(`🚀 License Upgraded: Added ${module}`);
        res.json({ success: true, modules });
    } catch (error) {
        console.error('License upgrade failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update configured modules
router.put('/modules', async (req, res) => {
    try {
        const { modules } = req.body;
        if (!Array.isArray(modules)) {
            return res.status(400).json({ error: 'Modules must be an array' });
        }

        const currentLicense = licenseService.getLicenseDetails();
        if (!currentLicense) return res.status(404).json({ error: 'No active license found' });

        // Ensure core critical modules are always present
        const coreModules = ['pos', 'inventory', 'reports', 'settings'];
        const finalModules = [...new Set([...modules, ...coreModules])];

        db.prepare('UPDATE license_store SET modules_enabled = ? WHERE id = ?')
            .run(JSON.stringify(finalModules), currentLicense.id);

        res.json({ success: true, modules: finalModules });
    } catch (error) {
        console.error('Failed to update modules:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
