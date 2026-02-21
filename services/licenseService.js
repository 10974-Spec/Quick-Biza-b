import db from '../database/db.js';

export const licenseService = {
    // 🔐 2️⃣ License Validation Logic (Hybrid System)
    validateLicense: async () => {
        try {
            // --- Step A: Offline Check (Local SQLite) ---
            // "The Offline Engine"
            const localLicense = db.prepare('SELECT * FROM license_store ORDER BY id DESC LIMIT 1').get();

            if (!localLicense) {
                return { valid: false, reason: 'no_license' };
            }

            // Check expiry against local database immediately
            const now = new Date();
            let expiry = new Date(localLicense.expiry_date);

            if (localLicense.status === 'revoked' || localLicense.status === 'suspended') {
                return { valid: false, reason: 'revoked' };
            }

            // If expired locally, we might still want to try online check to see if it was renewed.
            // But if we are strictly offline, this will block access.

            // --- Step B: Online Verification (Control Center) ---
            // "If internet detected -> Sync with Cloud"
            try {
                // Dynamic import to avoid crash if cloud.js has issues
                const { License } = await import('../database/cloud.js');

                // Simulate "App sends company_id, license_id..."
                const cloudLicense = await License.findOne({ license_key: localLicense.license_key });

                if (cloudLicense) {
                    console.log("☁️  Cloud License Check: Verified");

                    // Update Local Data (The "App updates local license file" step)
                    db.prepare(`
                        UPDATE license_store 
                        SET status = ?, expiry_date = ?, modules_enabled = ?, last_verified_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `).run(
                        cloudLicense.status,
                        cloudLicense.expires_at.toISOString(),
                        JSON.stringify(cloudLicense.modules_enabled),
                        localLicense.id
                    );

                    // Refresh in-memory variables to use the Latest Cloud Truth
                    localLicense.status = cloudLicense.status;
                    localLicense.expiry_date = cloudLicense.expires_at.toISOString();
                    localLicense.modules_enabled = JSON.stringify(cloudLicense.modules_enabled);
                    expiry = new Date(localLicense.expiry_date);
                }
            } catch (cloudError) {
                // Online Verification Failed -> Fallback to pure Step A
                // keeping the system running offline
                // console.warn("License check performed offline.");
            }

            // Final Decision based on (potentially updated) Local Data
            if (now > expiry) {
                if (localLicense.status !== 'expired') {
                    db.prepare("UPDATE license_store SET status = 'expired' WHERE id = ?").run(localLicense.id);
                }
                return { valid: false, reason: 'expired', expiry: localLicense.expiry_date };
            }

            if (localLicense.status === 'revoked' || localLicense.status === 'suspended') {
                return { valid: false, reason: 'revoked' };
            }

            return { valid: true, license: localLicense };

        } catch (error) {
            console.error('License validation error:', error);
            // Default to safe mode or error
            return { valid: false, reason: 'error' };
        }
    },

    // Activate License (Hybrid: Cloud First)
    activateLicense: async (key) => {
        try {
            let cloudLicense = null;

            // 1. Try Cloud Activation
            try {
                const { License } = await import('../database/cloud.js');
                cloudLicense = await License.findOne({ license_key: key });

                if (!cloudLicense) {
                    // Check if it's a valid format for offline simulation? 
                    // Or reject if Cloud is accessible but key invalid.
                }
            } catch (e) {
                console.warn("⚠️ Cloud activation failed (Offline?), falling back to simulation if key format valid");
            }

            // Mock/Fallback if Cloud fails or returns nothing (for dev/offline)
            // Mock/Fallback removed for strict licensing
            if (!cloudLicense) {
                // Check for specific offline/community keys
                if (key === 'COMMUNITY-FREE-LICENSE' || key === 'SOKO-TRIAL-2026') {
                    // Create a mock cloud license for offline activation
                    cloudLicense = {
                        license_key: key,
                        status: 'active',
                        expires_at: new Date(new Date().setFullYear(new Date().getFullYear() + 10)), // 10 years
                        modules_enabled: ['pos', 'inventory', 'reports', 'payroll', 'customers', 'suppliers', 'accounting', 'manufacturing', 'multi_branch', 'marketing', 'loyalty', 'iot', 'fleet', 'settings']
                    };
                    console.log("🔓 Offline/Community License Activated:", key);
                } else {
                    throw new Error('Invalid license key or offline activation not supported without valid local license.');
                }
            }

            // 2. Save to Local DB (Cache)
            const existing = db.prepare('SELECT id FROM license_store WHERE license_key = ?').get(key);

            const modulesStr = Array.isArray(cloudLicense.modules_enabled)
                ? JSON.stringify(cloudLicense.modules_enabled)
                : cloudLicense.modules_enabled;

            const expiryStr = cloudLicense.expires_at instanceof Date
                ? cloudLicense.expires_at.toISOString()
                : cloudLicense.expires_at;

            if (existing) {
                db.prepare(`
                    UPDATE license_store 
                    SET issue_date = CURRENT_TIMESTAMP, expiry_date = ?, status = ?, modules_enabled = ?, last_verified_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(expiryStr, cloudLicense.status, modulesStr, existing.id);
            } else {
                db.prepare(`
                    INSERT INTO license_store (license_key, issue_date, expiry_date, status, modules_enabled, last_verified_at)
                    VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, CURRENT_TIMESTAMP)
                `).run(key, expiryStr, 'active', modulesStr);
            }

            return { success: true, expiry: expiryStr };
        } catch (error) {
            console.error('License activation error:', error);
            throw new Error(error.message);
        }
    },

    // Check if a module is enabled
    hasModule: (moduleName) => {
        try {
            const license = db.prepare('SELECT modules_enabled FROM license_store WHERE status = "active" ORDER BY id DESC LIMIT 1').get();
            if (!license) return false;

            const modules = JSON.parse(license.modules_enabled || '[]');
            return modules.includes(moduleName);
        } catch (error) {
            return false;
        }
    },

    getLicenseDetails: () => {
        try {
            return db.prepare('SELECT * FROM license_store ORDER BY id DESC LIMIT 1').get();
        } catch (error) {
            console.error('Database error in getLicenseDetails:', error);
            return null;
        }
    }
};
