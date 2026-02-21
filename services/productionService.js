import db from '../database/db.js';

export const productionService = {

    // ─── INGREDIENTS (RAW MATERIALS) ──────────────────────────────────────────
    getAllIngredients: () => {
        return db.prepare('SELECT * FROM ingredients ORDER BY name').all();
    },

    createIngredient: (data) => {
        const stmt = db.prepare('INSERT INTO ingredients (name, unit, low_stock_threshold) VALUES (?, ?, ?)');
        const info = stmt.run(data.name, data.unit, data.low_stock_threshold || 0);
        return { id: info.lastInsertRowid, ...data };
    },

    // ─── RECIPES (BOM) ────────────────────────────────────────────────────────
    getRecipeForProduct: (productId) => {
        return db.prepare(`
      SELECT r.id, r.product_id, r.ingredient_id, r.quantity_required, i.name, i.unit 
      FROM recipes r
      JOIN ingredients i ON r.ingredient_id = i.id
      WHERE r.product_id = ?
    `).all(productId);
    },

    saveRecipe: (productId, ingredients) => {
        const deleteStmt = db.prepare('DELETE FROM recipes WHERE product_id = ?');
        const insertStmt = db.prepare('INSERT INTO recipes (product_id, ingredient_id, quantity_required) VALUES (?, ?, ?)');

        const transaction = db.transaction(() => {
            deleteStmt.run(productId);
            for (const item of ingredients) {
                insertStmt.run(productId, item.ingredient_id, item.quantity_required);
            }
        });

        transaction();
        return true;
    },

    // ─── PRODUCTION LOGIC ─────────────────────────────────────────────────────

    /**
     * Check if we have enough raw materials to produce X amount of a product
     */
    checkFeasibility: (productId, quantityToProduce) => {
        const recipe = productionService.getRecipeForProduct(productId);
        if (!recipe.length) {
            throw new Error("No recipe found for this product. Cannot produce.");
        }

        const feasibility = recipe.map(item => {
            const required = item.quantity_required * quantityToProduce;

            // Get current raw inventory for this ingredient
            // Note: Assuming inventory_raw tracks quantity by ingredient_id
            const stock = db.prepare('SELECT quantity FROM inventory_raw WHERE ingredient_id = ?').get(item.ingredient_id);
            const available = stock ? stock.quantity : 0;

            return {
                ingredient_id: item.ingredient_id,
                name: item.name,
                unit: item.unit,
                required,
                available,
                isSufficient: available >= required
            };
        });

        const canProduce = feasibility.every(f => f.isSufficient);

        return {
            canProduce,
            details: feasibility
        };
    },

    /**
     * Record production: Deduct raw materials, Add finished goods, Log it.
     */
    recordProduction: (data) => {
        const { product_id, quantity, user_id, notes } = data;

        // 1. Verify we can produce it
        const feasibility = productionService.checkFeasibility(product_id, quantity);
        if (!feasibility.canProduce) {
            const missing = feasibility.details.filter(d => !d.isSufficient).map(d => `${d.name} (Need: ${d.required}, Have: ${d.available})`).join(', ');
            throw new Error(`Insufficient raw materials: ${missing}`);
        }

        // Prepare statements
        const deductRaw = db.prepare('UPDATE inventory_raw SET quantity = quantity - ?, last_updated = CURRENT_TIMESTAMP WHERE ingredient_id = ?');
        const updateFinished = db.prepare('UPDATE inventory_finished SET quantity = quantity + ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?');
        const insertFinished = db.prepare('INSERT INTO inventory_finished (product_id, quantity, last_updated) VALUES (?, ?, CURRENT_TIMESTAMP)');
        const checkFinished = db.prepare('SELECT id FROM inventory_finished WHERE product_id = ?');
        const logProd = db.prepare('INSERT INTO production_logs (product_id, quantity_produced, notes, produced_by) VALUES (?, ?, ?, ?)');

        // For Aroma framework, actual product stock is in inventory_finished table now.

        const transaction = db.transaction(() => {
            // 2. Deduct Raw Materials
            for (const item of feasibility.details) {
                deductRaw.run(item.required, item.ingredient_id);
            }

            // 3. Add to Finished Goods Stock
            let stockRes = updateFinished.run(quantity, product_id);
            if (stockRes.changes === 0) {
                // Doesn't exist yet, insert it
                insertFinished.run(product_id, quantity);
            }

            // 4. Log Production
            const info = logProd.run(product_id, quantity, notes || '', user_id || 1);
            return info.lastInsertRowid;
        });

        return transaction();
    },

    getProductionLogs: () => {
        return db.prepare(`
      SELECT l.*, p.name as product_name, u.full_name as user_name
      FROM production_logs l
      JOIN products p ON l.product_id = p.id
      LEFT JOIN users u ON l.produced_by = u.id
      ORDER BY l.created_at DESC
    `).all();
    }
};
