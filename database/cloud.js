import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || '';

let isConnected = false;

export const connectCloudDB = async () => {
    if (isConnected) return;
    if (!MONGO_URI) {
        console.warn('⚠️  MONGO_URI not set — cloud sync disabled.');
        return;
    }
    try {
        await mongoose.connect(MONGO_URI);
        isConnected = true;
        console.log("✅ Connected to Aroma Cloud (MongoDB)");
    } catch (error) {
        console.error("❌ Failed to connect to Aroma Cloud:", error.message);
        // Don't crash — system works offline
    }
};

export const getIsConnected = () => isConnected;

// ─── SaaS / Platform Schemas ────────────────────────────────────────────────

const CompanySchema = new mongoose.Schema({
    name: { type: String, required: true },
    business_type: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    address: String,
    logo_url: String,
    theme_preference: { type: String, default: 'default' },
    primary_color: { type: String, default: '#ea580c' },
    registered_at: { type: Date, default: Date.now },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' }
});

const LicenseSchema = new mongoose.Schema({
    company_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    license_key: { type: String, required: true, unique: true },
    plan_type: { type: String, enum: ['trial', 'basic', 'standard', 'premium', 'enterprise'], default: 'standard' },
    status: { type: String, enum: ['active', 'expired', 'revoked'], default: 'active' },
    issued_at: { type: Date, default: Date.now },
    expires_at: { type: Date, required: true },
    max_users: { type: Number, default: 5 },
    max_devices: { type: Number, default: 2 },
    modules_enabled: [String],
    last_validated_at: Date
});

const SubscriptionSchema = new mongoose.Schema({
    company_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    plan_name: String,
    amount: Number,
    currency: { type: String, default: 'KES' },
    billing_cycle: { type: String, enum: ['monthly', 'annual'], default: 'monthly' },
    start_date: Date,
    end_date: Date,
    payment_status: { type: String, enum: ['paid', 'pending', 'failed'], default: 'pending' },
    transaction_ref: String
});

const AppVersionSchema = new mongoose.Schema({
    version: { type: String, required: true, unique: true },
    release_notes: String,
    release_date: { type: Date, default: Date.now },
    critical: { type: Boolean, default: false },
    download_url: String
});

// ─── Data Sync Schemas (mirrors local SQLite tables in cloud) ────────────────
// Each document carries: local_id (SQLite rowid), company_id, synced_at

const syncBase = {
    local_id: { type: Number, required: true },
    company_id: { type: String, required: true },  // identifies the install
    synced_at: { type: Date, default: Date.now }
};

const SaleSchema = new mongoose.Schema({
    ...syncBase,
    customer_id: Number,
    subtotal: Number,
    discount_percent: Number,
    discount_amount: Number,
    total: Number,
    status: String,
    cashier_id: Number,
    created_at: Date,
    items: [{ product_id: Number, product_name: String, quantity: Number, unit_price: Number, subtotal: Number }],
    payments: [{ method: String, amount: Number, mpesa_receipt: String, status: String }]
}, { collection: 'sync_sales' });
SaleSchema.index({ local_id: 1, company_id: 1 }, { unique: true });

const ProductSchema = new mongoose.Schema({
    ...syncBase,
    name: String,
    category_id: Number,
    price: Number,
    barcode: String,
    emoji: String,
    description: String,
    active: Number,
    created_at: Date
}, { collection: 'sync_products' });
ProductSchema.index({ local_id: 1, company_id: 1 }, { unique: true });

const CustomerSchema = new mongoose.Schema({
    ...syncBase,
    name: String,
    phone: String,
    email: String,
    birthday: Date,
    loyalty_points: Number,
    store_credit: Number,
    created_at: Date
}, { collection: 'sync_customers' });
CustomerSchema.index({ local_id: 1, company_id: 1 }, { unique: true });

const OrderSchema = new mongoose.Schema({
    ...syncBase,
    customer_id: Number,
    item_description: String,
    total_price: Number,
    deposit_paid: Number,
    balance: Number,
    pickup_date: Date,
    status: String,
    notes: String,
    created_by: Number,
    created_at: Date
}, { collection: 'sync_orders' });
OrderSchema.index({ local_id: 1, company_id: 1 }, { unique: true });

const InventoryRawSchema = new mongoose.Schema({
    ...syncBase,
    ingredient_id: Number,
    ingredient_name: String,
    quantity: Number,
    unit: String,
    low_stock_threshold: Number,
    last_updated: Date
}, { collection: 'sync_inventory_raw' });
InventoryRawSchema.index({ local_id: 1, company_id: 1 }, { unique: true });

const InventoryFinishedSchema = new mongoose.Schema({
    ...syncBase,
    product_id: Number,
    product_name: String,
    quantity: Number,
    last_updated: Date
}, { collection: 'sync_inventory_finished' });
InventoryFinishedSchema.index({ local_id: 1, company_id: 1 }, { unique: true });

const PurchaseSchema = new mongoose.Schema({
    ...syncBase,
    supplier_id: Number,
    supplier_name: String,
    total_amount: Number,
    payment_status: String,
    amount_paid: Number,
    created_by: Number,
    created_at: Date,
    items: [{ ingredient_id: Number, quantity: Number, unit_cost: Number, subtotal: Number }]
}, { collection: 'sync_purchases' });
PurchaseSchema.index({ local_id: 1, company_id: 1 }, { unique: true });

const ExpenseSchema = new mongoose.Schema({
    ...syncBase,
    category: String,
    description: String,
    amount: Number,
    expense_date: Date,
    created_by: Number,
    created_at: Date
}, { collection: 'sync_expenses' });
ExpenseSchema.index({ local_id: 1, company_id: 1 }, { unique: true });

const StaffSchema = new mongoose.Schema({
    ...syncBase,
    username: String,
    full_name: String,
    role: String,
    status: String,
    created_at: Date
}, { collection: 'sync_staff' });
StaffSchema.index({ local_id: 1, company_id: 1 }, { unique: true });

const AppSettingsSchema = new mongoose.Schema({
    ...syncBase,
    theme: String,
    primary_color: String,
    receipt_footer_text: String,
    company_name: String,
    updated_at: Date
}, { collection: 'sync_settings' });
AppSettingsSchema.index({ local_id: 1, company_id: 1 }, { unique: true });

// ─── Models ──────────────────────────────────────────────────────────────────

// Platform models
export const Company = mongoose.model('Company', CompanySchema);
export const License = mongoose.model('License', LicenseSchema);
export const Subscription = mongoose.model('Subscription', SubscriptionSchema);
export const AppVersion = mongoose.model('AppVersion', AppVersionSchema);

// Sync data models
export const CloudSale = mongoose.model('CloudSale', SaleSchema);
export const CloudProduct = mongoose.model('CloudProduct', ProductSchema);
export const CloudCustomer = mongoose.model('CloudCustomer', CustomerSchema);
export const CloudOrder = mongoose.model('CloudOrder', OrderSchema);
export const CloudInventoryRaw = mongoose.model('CloudInventoryRaw', InventoryRawSchema);
export const CloudInventoryFinished = mongoose.model('CloudInventoryFinished', InventoryFinishedSchema);
export const CloudPurchase = mongoose.model('CloudPurchase', PurchaseSchema);
export const CloudExpense = mongoose.model('CloudExpense', ExpenseSchema);
export const CloudStaff = mongoose.model('CloudStaff', StaffSchema);
export const CloudAppSettings = mongoose.model('CloudAppSettings', AppSettingsSchema);
