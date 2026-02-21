import db from '../database/db.js';
import { productionService } from '../services/productionService.js';

console.log('\n🍞 Seeding Production & Recipes...\n');

try {
    // 0. Wipe existing to avoid Unique Constraint errors
    db.prepare('PRAGMA foreign_keys = OFF').run();
    db.prepare('DELETE FROM ingredients').run();
    db.prepare('DELETE FROM inventory_raw').run();
    db.prepare('DELETE FROM recipes').run();
    db.prepare('DELETE FROM production_logs').run();
    db.prepare('PRAGMA foreign_keys = ON').run();

    // 1. Create Raw Materials (Ingredients)
    const flour = productionService.createIngredient({ name: 'Wheat Flour', unit: 'kg', low_stock_threshold: 50 });
    const sugar = productionService.createIngredient({ name: 'White Sugar', unit: 'kg', low_stock_threshold: 20 });
    const yeast = productionService.createIngredient({ name: 'Baking Yeast', unit: 'g', low_stock_threshold: 1000 });
    const butter = productionService.createIngredient({ name: 'Baking Butter', unit: 'kg', low_stock_threshold: 10 });
    console.log('  ✅ Ingredients created (Flour, Sugar, Yeast, Butter)');

    // 2. Add some raw inventory
    const addStock = db.prepare('INSERT INTO inventory_raw (ingredient_id, quantity, last_updated) VALUES (?, ?, CURRENT_TIMESTAMP)');
    addStock.run(flour.id, 100); // 100 kg
    addStock.run(sugar.id, 50);  // 50 kg
    addStock.run(yeast.id, 5000); // 5000 g
    addStock.run(butter.id, 20); // 20 kg
    console.log('  ✅ Raw materials stocked in inventory_raw');

    // 3. Ensure a Bakery Product Exists
    let product = db.prepare("SELECT id FROM products WHERE name LIKE '%Bread%'").get();
    if (!product) {
        const pStmt = db.prepare('INSERT INTO products (name, price, category_id) VALUES (?, ?, ?)');
        const cat = db.prepare('SELECT id FROM categories LIMIT 1').get() || { id: 1 };
        db.prepare("INSERT OR IGNORE INTO categories (id, name) VALUES (1, 'Bakery')").run();
        product = { id: pStmt.run('Premium White Bread', 120, cat.id).lastInsertRowid };
    }

    // 4. Create a Recipe (BOM) for the Bread (To make 1 loaf)
    // Recipe: 0.5kg flour, 0.05kg sugar, 10g yeast, 0.02kg butter
    productionService.saveRecipe(product.id, [
        { ingredient_id: flour.id, quantity_required: 0.5 },
        { ingredient_id: sugar.id, quantity_required: 0.05 },
        { ingredient_id: yeast.id, quantity_required: 10 },
        { ingredient_id: butter.id, quantity_required: 0.02 },
    ]);
    console.log('  ✅ BOM Recipe saved for White Bread');

    // 5. Test Feasibility
    console.log('\n  🧪 Checking Feasibility to bake 100 loaves...');
    const feasibility = productionService.checkFeasibility(product.id, 100);
    console.log('     Can produce 100 loaves?', feasibility.canProduce);
    feasibility.details.forEach(d => console.log(`     - ${d.name}: needs ${d.required}${d.unit}, has ${d.available}${d.unit}`));

    // 6. Record Production of 50 loaves
    if (feasibility.canProduce) {
        console.log('\n  🏭 Baking 50 loaves...');
        productionService.recordProduction({
            product_id: product.id,
            quantity: 50,
            user_id: 1,
            notes: 'Morning batch'
        });
        console.log('  ✅ 50 loaves baked! Raw materials deducted, Finished inventory increased.');

        const newStock = db.prepare('SELECT quantity FROM inventory_finished WHERE product_id = ?').get(product.id);
        console.log(`  📊 New stock for Bread: ${newStock ? newStock.quantity : 0}`);

        const newFlour = db.prepare('SELECT quantity FROM inventory_raw WHERE ingredient_id = ?').get(flour.id);
        console.log(`  📊 Remaining Flour: ${newFlour.quantity} kg`);
    }

} catch (err) {
    console.error('❌ Error seeding production:', err);
}

console.log('\n✅ Production module seed complete!\n');
