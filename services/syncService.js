/**
 * ============================================================
 *  QuickBiza POS — Hybrid Cloud Sync Service
 * ============================================================
 *
 *  Two sync modes:
 *  1. Real-time: call `syncNow(table, id)` immediately after every write
 *  2. Scheduled: full sync every 60s as a safety net
 *
 *  Design Principles:
 *  - Offline-FIRST: local SQLite is always the primary DB
 *  - Non-blocking: sync errors never crash the server
 *  - Idempotent: upsert by { local_id, company_id } — safe to re-run
 *  - Live connectivity detection: checks mongoose.connection.readyState
 */

import mongoose from 'mongoose';
import dns from 'dns';
import { connectCloudDB } from '../database/cloud.js';
import {
    CloudSale,
    CloudProduct,
    CloudCustomer,
    CloudOrder,
    CloudInventoryRaw,
    CloudInventoryFinished,
    CloudPurchase,
    CloudExpense,
    CloudStaff,
    CloudAppSettings
} from '../database/cloud.js';
import db from '../database/db.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import os from 'os';

const SYNC_INTERVAL_MS = 60 * 1000; // full sweep every 60 seconds

// ─── Connectivity Detection ───────────────────────────────────────────────────
// Layer 1: OS network (DNS lookup) — detects WiFi, Ethernet, any connection
function isNetworkAvailable() {
    return new Promise(resolve => {
        dns.lookup('8.8.8.8', (err) => resolve(!err));
    });
}

// Layer 2: Mongoose connection (live readyState)
function isMongoConnected() {
    return mongoose.connection.readyState === 1;
}

// ─── Sync State ─────────────────────────────────────────────────────────────
export const syncState = {
    status: 'idle',           // 'idle' | 'syncing' | 'synced' | 'offline' | 'error'
    lastSyncAt: null,
    lastSyncError: null,
    recordsSynced: 0,
    company_id: null,
};

// ─── Company ID (one per installation) ───────────────────────────────────────
function getCompanyId() {
    try {
        const license = db.prepare('SELECT license_key FROM license_store WHERE status = ? LIMIT 1').get('active');
        if (license?.license_key) return license.license_key;
    } catch (_) { }

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const idFile = join(__dirname, '../.company_id');
    if (fs.existsSync(idFile)) return fs.readFileSync(idFile, 'utf-8').trim();
    const uuid = `${os.hostname()}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    fs.writeFileSync(idFile, uuid);
    return uuid;
}

// ─── Upsert helper ───────────────────────────────────────────────────────────
async function upsertMany(Model, docs, company_id) {
    if (!docs.length) return 0;
    const ops = docs.map(doc => ({
        updateOne: {
            filter: { local_id: doc.local_id, company_id },
            update: { $set: { ...doc, company_id, synced_at: new Date() } },
            upsert: true
        }
    }));
    const res = await Model.bulkWrite(ops, { ordered: false });
    return res.upsertedCount + res.modifiedCount;
}

async function upsertOne(Model, doc, company_id) {
    return upsertMany(Model, [doc], company_id);
}

// ─── Sync Queue Helpers ───────────────────────────────────────────────────────

// Tables that carry per-row sync metadata (added by db.js migration)
const TRACKABLE_TABLES = new Set(['sales', 'products', 'customers', 'orders', 'expenses', 'purchases']);

/**
 * Enqueue a record for cloud sync.
 * Call this immediately after every write (INSERT/UPDATE).
 */
export function enqueueSync(table, recordId) {
    try {
        // Remove any existing entry so we don't accumulate duplicates
        db.prepare('DELETE FROM sync_queue WHERE table_name = ? AND record_id = ?').run(table, recordId);
        db.prepare(`
            INSERT INTO sync_queue (table_name, record_id, operation, created_at)
            VALUES (?, ?, 'upsert', datetime('now'))
        `).run(table, recordId);
        // Mark the row as pending
        if (TRACKABLE_TABLES.has(table)) {
            try {
                db.prepare(`UPDATE ${table} SET sync_status = 'pending', updated_at = datetime('now') WHERE id = ?`).run(recordId);
            } catch (_) { }
        }
    } catch (err) {
        console.warn('⚡ enqueueSync failed:', err.message);
    }
}

/**
 * Mark a record as synced in both the main table and the queue.
 */
function markSynced(table, recordId) {
    try {
        db.prepare('DELETE FROM sync_queue WHERE table_name = ? AND record_id = ?').run(table, recordId);
        if (TRACKABLE_TABLES.has(table)) {
            try {
                db.prepare(`UPDATE ${table} SET sync_status = 'synced' WHERE id = ?`).run(recordId);
            } catch (_) { }
        }
    } catch (_) { }
}

/**
 * Process the sync_queue — retry any pending entries (up to 5 attempts).
 * Called at the end of each scheduled full sweep.
 */
async function processQueue(company_id) {
    const pending = db.prepare(`
        SELECT * FROM sync_queue WHERE retry_count < 5 ORDER BY created_at LIMIT 50
    `).all();
    if (!pending.length) return;

    for (const entry of pending) {
        try {
            await syncRecord(entry.table_name, entry.record_id);
            markSynced(entry.table_name, entry.record_id);
        } catch (_) {
            db.prepare(`
                UPDATE sync_queue
                SET retry_count = retry_count + 1, last_attempt = datetime('now')
                WHERE id = ?
            `).run(entry.id);
        }
    }
}



function buildSaleDoc(s, saleItems, payments) {
    return {
        local_id: s.id,
        customer_id: s.customer_id,
        subtotal: s.subtotal,
        discount_percent: s.discount_percent,
        discount_amount: s.discount_amount,
        total: s.total,
        status: s.status,
        cashier_id: s.cashier_id,
        created_at: s.created_at ? new Date(s.created_at) : null,
        items: (saleItems || []).map(i => ({
            product_id: i.product_id, product_name: i.product_name,
            quantity: i.quantity, unit_price: i.unit_price, subtotal: i.subtotal
        })),
        payments: (payments || []).map(p => ({
            method: p.method, amount: p.amount, mpesa_receipt: p.mpesa_receipt, status: p.status
        }))
    };
}

async function syncSales(company_id) {
    const sales = db.prepare('SELECT * FROM sales ORDER BY id').all();
    const saleItems = db.prepare('SELECT * FROM sale_items').all();
    const payments = db.prepare('SELECT * FROM payments').all();
    const docs = sales.map(s => buildSaleDoc(
        s,
        saleItems.filter(i => i.sale_id === s.id),
        payments.filter(p => p.sale_id === s.id)
    ));
    return upsertMany(CloudSale, docs, company_id);
}

async function syncProducts(company_id) {
    const rows = db.prepare('SELECT * FROM products').all();
    const docs = rows.map(r => ({
        local_id: r.id, name: r.name, category_id: r.category_id,
        price: r.price, barcode: r.barcode, emoji: r.emoji,
        description: r.description, active: r.active,
        created_at: r.created_at ? new Date(r.created_at) : null
    }));
    return upsertMany(CloudProduct, docs, company_id);
}

async function syncCustomers(company_id) {
    const rows = db.prepare('SELECT * FROM customers').all();
    const docs = rows.map(r => ({
        local_id: r.id, name: r.name, phone: r.phone, email: r.email,
        birthday: r.birthday ? new Date(r.birthday) : null,
        loyalty_points: r.loyalty_points, store_credit: r.store_credit,
        created_at: r.created_at ? new Date(r.created_at) : null
    }));
    return upsertMany(CloudCustomer, docs, company_id);
}

async function syncOrders(company_id) {
    const rows = db.prepare('SELECT * FROM orders').all();
    const docs = rows.map(r => ({
        local_id: r.id, customer_id: r.customer_id,
        item_description: r.item_description, total_price: r.total_price,
        deposit_paid: r.deposit_paid, balance: r.balance,
        pickup_date: r.pickup_date ? new Date(r.pickup_date) : null,
        status: r.status, notes: r.notes, created_by: r.created_by,
        created_at: r.created_at ? new Date(r.created_at) : null
    }));
    return upsertMany(CloudOrder, docs, company_id);
}

async function syncInventory(company_id) {
    const raw = db.prepare(`
        SELECT ir.*, i.name as ingredient_name, i.unit, i.low_stock_threshold
        FROM inventory_raw ir LEFT JOIN ingredients i ON i.id = ir.ingredient_id
    `).all();
    const rawDocs = raw.map(r => ({
        local_id: r.id, ingredient_id: r.ingredient_id,
        ingredient_name: r.ingredient_name, quantity: r.quantity,
        unit: r.unit, low_stock_threshold: r.low_stock_threshold,
        last_updated: r.last_updated ? new Date(r.last_updated) : null
    }));

    const finished = db.prepare(`
        SELECT inf.*, p.name as product_name
        FROM inventory_finished inf LEFT JOIN products p ON p.id = inf.product_id
    `).all();
    const finishedDocs = finished.map(r => ({
        local_id: r.id, product_id: r.product_id,
        product_name: r.product_name, quantity: r.quantity,
        last_updated: r.last_updated ? new Date(r.last_updated) : null
    }));

    const r1 = await upsertMany(CloudInventoryRaw, rawDocs, company_id);
    const r2 = await upsertMany(CloudInventoryFinished, finishedDocs, company_id);
    return r1 + r2;
}

async function syncPurchases(company_id) {
    const purchases = db.prepare(`
        SELECT p.*, s.name as supplier_name FROM purchases p
        LEFT JOIN suppliers s ON s.id = p.supplier_id
    `).all();
    const purchaseItems = db.prepare('SELECT * FROM purchase_items').all();
    const docs = purchases.map(r => ({
        local_id: r.id, supplier_id: r.supplier_id,
        supplier_name: r.supplier_name, total_amount: r.total_amount,
        payment_status: r.payment_status, amount_paid: r.amount_paid,
        created_by: r.created_by,
        created_at: r.created_at ? new Date(r.created_at) : null,
        items: purchaseItems.filter(i => i.purchase_id === r.id).map(i => ({
            ingredient_id: i.ingredient_id, quantity: i.quantity,
            unit_cost: i.unit_cost, subtotal: i.subtotal
        }))
    }));
    return upsertMany(CloudPurchase, docs, company_id);
}

async function syncExpenses(company_id) {
    const rows = db.prepare('SELECT * FROM expenses').all();
    const docs = rows.map(r => ({
        local_id: r.id, category: r.category, description: r.description,
        amount: r.amount,
        expense_date: r.expense_date ? new Date(r.expense_date) : null,
        created_by: r.created_by,
        created_at: r.created_at ? new Date(r.created_at) : null
    }));
    return upsertMany(CloudExpense, docs, company_id);
}

async function syncStaff(company_id) {
    const rows = db.prepare('SELECT id, username, full_name, role, status, created_at FROM users').all();
    const docs = rows.map(r => ({
        local_id: r.id, username: r.username, full_name: r.full_name,
        role: r.role, status: r.status,
        created_at: r.created_at ? new Date(r.created_at) : null
    }));
    return upsertMany(CloudStaff, docs, company_id);
}

async function syncSettings(company_id) {
    try {
        const row = db.prepare('SELECT * FROM app_settings LIMIT 1').get();
        if (!row) return 0;
        return upsertOne(CloudAppSettings, {
            local_id: row.id, theme: row.theme, primary_color: row.primary_color,
            receipt_footer_text: row.receipt_footer_text, company_name: row.company_name,
            updated_at: row.updated_at ? new Date(row.updated_at) : null
        }, company_id);
    } catch (_) { return 0; }
}

// ─── Real-time Single-Record Sync ────────────────────────────────────────────
// Call this immediately after any write (create/update) to push to cloud now.
export async function syncRecord(table, id) {
    const hasNetwork = await isNetworkAvailable();
    if (!hasNetwork || !isMongoConnected()) return;
    const company_id = syncState.company_id || (syncState.company_id = getCompanyId());

    try {
        switch (table) {
            case 'products': {
                const r = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
                if (r) await upsertOne(CloudProduct, {
                    local_id: r.id, name: r.name, category_id: r.category_id,
                    price: r.price, barcode: r.barcode, emoji: r.emoji,
                    description: r.description, active: r.active,
                    created_at: r.created_at ? new Date(r.created_at) : null
                }, company_id);
                break;
            }
            case 'sales': {
                const s = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
                if (s) {
                    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id);
                    const pmts = db.prepare('SELECT * FROM payments WHERE sale_id = ?').all(id);
                    await upsertOne(CloudSale, buildSaleDoc(s, items, pmts), company_id);
                }
                break;
            }
            case 'customers': {
                const r = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
                if (r) await upsertOne(CloudCustomer, {
                    local_id: r.id, name: r.name, phone: r.phone, email: r.email,
                    birthday: r.birthday ? new Date(r.birthday) : null,
                    loyalty_points: r.loyalty_points, store_credit: r.store_credit,
                    created_at: r.created_at ? new Date(r.created_at) : null
                }, company_id);
                break;
            }
            case 'orders': {
                const r = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
                if (r) await upsertOne(CloudOrder, {
                    local_id: r.id, customer_id: r.customer_id,
                    item_description: r.item_description, total_price: r.total_price,
                    deposit_paid: r.deposit_paid, balance: r.balance,
                    pickup_date: r.pickup_date ? new Date(r.pickup_date) : null,
                    status: r.status, notes: r.notes, created_by: r.created_by,
                    created_at: r.created_at ? new Date(r.created_at) : null
                }, company_id);
                break;
            }
            case 'expenses': {
                const r = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
                if (r) await upsertOne(CloudExpense, {
                    local_id: r.id, category: r.category, description: r.description,
                    amount: r.amount,
                    expense_date: r.expense_date ? new Date(r.expense_date) : null,
                    created_by: r.created_by,
                    created_at: r.created_at ? new Date(r.created_at) : null
                }, company_id);
                break;
            }
            case 'purchases': {
                await syncPurchases(company_id); // purchases always bulk sync (items relation)
                break;
            }
            default:
                break;
        }
    } catch (err) {
        // Never crash the server for a realtime sync failure
        console.warn(`☁️  Real-time sync failed for ${table}/${id}:`, err.message);
    }
}

// ─── Full Sweep Sync (scheduled) ─────────────────────────────────────────────
async function runSync() {
    // Layer 1: Check OS network (WiFi/Ethernet)
    const hasNetwork = await isNetworkAvailable();
    if (!hasNetwork) {
        syncState.status = 'offline';
        return;
    }

    // Layer 2: Check Mongo — if OS has internet but Mongo dropped, try reconnecting
    if (!isMongoConnected()) {
        try {
            await connectCloudDB();
        } catch (_) { }
        // Give it a moment then check again
        await new Promise(r => setTimeout(r, 1000));
        if (!isMongoConnected()) {
            // OS online but can't reach Mongo — still show error, not "offline"
            syncState.status = 'error';
            syncState.lastSyncError = 'Cannot reach MongoDB — check MONGO_URI';
            return;
        }
    }

    if (syncState.status === 'syncing') return;
    syncState.status = 'syncing';

    try {
        const company_id = syncState.company_id || (syncState.company_id = getCompanyId());

        const results = await Promise.allSettled([
            syncSales(company_id),
            syncProducts(company_id),
            syncCustomers(company_id),
            syncOrders(company_id),
            syncInventory(company_id),
            syncPurchases(company_id),
            syncExpenses(company_id),
            syncStaff(company_id),
            syncSettings(company_id),
        ]);

        let total = 0;
        results.forEach(r => { if (r.status === 'fulfilled') total += r.value; });

        syncState.status = 'synced';
        syncState.lastSyncAt = new Date();
        syncState.recordsSynced = total;
        syncState.lastSyncError = null;

        if (total > 0) {
            console.log(`☁️  Cloud sync complete — ${total} records at ${syncState.lastSyncAt.toISOString()}`);
        }

        // Drain any queued/failed records from previous offline period
        await processQueue(company_id);
    } catch (error) {
        syncState.status = 'error';
        syncState.lastSyncError = error.message;
        console.error('☁️  Cloud sync error:', error.message);
    }
}

// ─── Start Scheduler ─────────────────────────────────────────────────────────
export function startSyncScheduler() {
    console.log(`☁️  Cloud sync scheduler started (every ${SYNC_INTERVAL_MS / 1000}s)`);
    setTimeout(runSync, 5000);
    setInterval(runSync, SYNC_INTERVAL_MS);
}
