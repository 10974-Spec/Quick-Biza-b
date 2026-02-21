import db from './database/db.js';

console.log("Migrating database schema...");

try {
    // 1. Update 'orders' table
    console.log("Checking 'orders' table columns...");
    const ordersInfo = db.prepare("PRAGMA table_info(orders)").all();
    const orderColumns = ordersInfo.map(c => c.name);

    if (!orderColumns.includes('product_name')) {
        console.log("Adding 'product_name' to orders...");
        db.prepare("ALTER TABLE orders ADD COLUMN product_name TEXT").run();
    }
    if (!orderColumns.includes('quantity')) {
        console.log("Adding 'quantity' to orders...");
        db.prepare("ALTER TABLE orders ADD COLUMN quantity INTEGER DEFAULT 1").run();
    }
    if (!orderColumns.includes('unit_price')) {
        console.log("Adding 'unit_price' to orders...");
        db.prepare("ALTER TABLE orders ADD COLUMN unit_price REAL DEFAULT 0").run();
    }

    // 2. Refresh 'purchases' table info to be sure (no migration needed based on previous check, but good to verify purchase_items)
    console.log("Checking 'purchase_items' table info...");
    const purchaseItemsInfo = db.prepare("PRAGMA table_info(purchase_items)").all();
    console.log(purchaseItemsInfo.map(c => c.name));

    console.log("Migration completed successfully.");
} catch (error) {
    console.error("Migration failed:", error);
}
