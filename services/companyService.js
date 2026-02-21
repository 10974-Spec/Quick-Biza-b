import db from '../database/db.js';

export const companyService = {
    // Check if company is already set up
    isSetup: () => {
        const profile = db.prepare('SELECT count(*) as count FROM company_profile').get();
        return profile.count > 0;
    },

    // Create or Update company profile
    createCompany: (data) => {
        const createTransaction = db.transaction(() => {
            const existing = db.prepare('SELECT * FROM company_profile LIMIT 1').get();
            let info;

            if (existing) {
                // Update existing
                console.log('[Setup] Updating existing company profile...');
                const stmt = db.prepare(`
                    UPDATE company_profile 
                    SET name = ?, email = ?, phone = ?, country = ?, business_type = ?, setup_completed = 1
                    WHERE id = ?
                `);
                info = stmt.run(data.name, data.email, data.phone, data.country, data.businessType, existing.id);
                info.lastInsertRowid = existing.id; // Preserve ID for return
            } else {
                // Insert new
                console.log('[Setup] Creating new company profile...');
                const stmt = db.prepare(`
                  INSERT INTO company_profile (name, email, phone, country, business_type, setup_completed)
                  VALUES (?, ?, ?, ?, ?, 1)
                `);
                info = stmt.run(data.name, data.email, data.phone, data.country, data.businessType);
            }

            // Initialize default settings based on business type
            // Cleanup conditions:
            // 1. New company AND businessType != 'bakery' (Clean slate)
            // 2. Existing company AND businessType CHANGED (Clean slate for new type)
            // 3. Existing company AND businessType != 'bakery' (Re-running setup for same non-bakery type - ensure clean)

            const shouldCleanup =
                (data.businessType !== 'bakery') &&
                (!existing || existing.business_type !== data.businessType || existing.business_type === data.businessType);

            // Optimization: Only run cleanup if explicitly switching away from Bakery defaults 
            // OR if we are re-running setup for a non-bakery business (to ensure integrity)

            if (shouldCleanup) {
                console.log(`[Setup] Clearing bakery demo data for business type: ${data.businessType}`);

                try {
                    // Transactional Data (Delete first to satisfy Foreign Keys)
                    db.prepare('DELETE FROM payments').run();
                    db.prepare('DELETE FROM sale_items').run();
                    db.prepare('DELETE FROM sales').run();
                    db.prepare('DELETE FROM purchase_payments').run();
                    db.prepare('DELETE FROM purchase_items').run();
                    db.prepare('DELETE FROM purchases').run();
                    db.prepare('DELETE FROM production_logs').run();
                    db.prepare('DELETE FROM transfers').run();
                    db.prepare('DELETE FROM inventory_logs').run();
                    db.prepare('DELETE FROM orders').run();

                    // Inventory & Relationships
                    db.prepare('DELETE FROM recipes').run();
                    db.prepare('DELETE FROM inventory_finished').run();
                    db.prepare('DELETE FROM inventory_raw').run();

                    // Master Data
                    db.prepare('DELETE FROM products').run();
                    db.prepare('DELETE FROM ingredients').run();
                    db.prepare('DELETE FROM categories').run();
                    db.prepare('DELETE FROM suppliers').run();
                    db.prepare('DELETE FROM customers').run();

                    console.log('[Setup] Bakery demo data cleared.');
                } catch (error) {
                    console.error('[Setup] Transaction Failed:', error);
                    throw error; // Re-throw to abort transaction
                }
            }
            return info;
        });

        try {
            const info = createTransaction();
            return { id: info.lastInsertRowid, ...data };
        } catch (error) {
            console.error('[Setup] createCompany failed:', error);
            throw error;
        }
    },

    // Get company details
    getCompany: () => {
        return db.prepare('SELECT * FROM company_profile LIMIT 1').get();
    },

    // Update company details
    updateCompany: (data) => {
        const stmt = db.prepare(`
      UPDATE company_profile
      SET name = ?, email = ?, phone = ?, country = ?
      WHERE id = (SELECT id FROM company_profile LIMIT 1)
    `);

        stmt.run(data.name, data.email, data.phone, data.country);
        return companyService.getCompany();
    }
};
