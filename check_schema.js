import db from './database/db.js';

console.log("Checking 'purchases' table info:");
try {
    const purchasesInfo = db.prepare("PRAGMA table_info(purchases)").all();
    console.log(purchasesInfo.map(c => c.name));
} catch (e) {
    console.error(e.message);
}

console.log("\nChecking 'orders' table info:");
try {
    const ordersInfo = db.prepare("PRAGMA table_info(orders)").all();
    console.log(ordersInfo.map(c => c.name));
} catch (e) {
    console.error(e.message);
}
