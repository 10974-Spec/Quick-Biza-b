import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = process.env.USER_DATA_PATH
  ? join(process.env.USER_DATA_PATH, 'aroma.db')
  : (process.env.DB_PATH || join(__dirname, 'aroma.db'));

// Ensure database directory exists
const dbDir = dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON'); // Ensure foreign keys are enforced // Ensure foreign keys are enforced

// Initialize database schema
export function initializeDatabase() {
  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'manager', 'cashier', 'baker')),
      permissions TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'disabled')),
      company_id INTEGER DEFAULT 1, -- Default to 1 (Main Company/Tenant)
      profile_image TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      last_login DATETIME,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);

  // Roles table
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      permissions TEXT,
      is_system INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Categories table
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      company_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name, company_id)
    );
  `);

  // Products table (finished goods)
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category_id INTEGER,
      company_id INTEGER DEFAULT 1,
      price REAL NOT NULL,
      barcode TEXT,
      emoji TEXT,
      description TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id),
      UNIQUE(barcode, company_id)
    );
  `);



  // Invites
  db.exec(`
    CREATE TABLE IF NOT EXISTS invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL,
      permissions TEXT,
      shop_name TEXT,
      is_used INTEGER DEFAULT 0,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      used_at DATETIME,
      used_by INTEGER
    );
  `);

  // Ingredients table (raw materials)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ingredients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      unit TEXT NOT NULL,
      low_stock_threshold REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Recipes table (product to ingredient mapping)
  db.exec(`
    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      ingredient_id INTEGER NOT NULL,
      quantity_required REAL NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (ingredient_id) REFERENCES ingredients(id),
      UNIQUE(product_id, ingredient_id)
    );
  `);

  // Raw materials inventory
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_raw (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ingredient_id INTEGER UNIQUE NOT NULL,
      quantity REAL DEFAULT 0,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
    );
  `);

  // Finished goods inventory
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_finished (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER UNIQUE NOT NULL,
      quantity INTEGER DEFAULT 0,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);

  // Inventory movement logs
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('raw', 'finished')),
      item_id INTEGER NOT NULL,
      movement_type TEXT NOT NULL CHECK(movement_type IN ('sale', 'purchase', 'production', 'adjustment', 'waste', 'refund')),
      quantity_change REAL NOT NULL,
      quantity_after REAL NOT NULL,
      reference_id INTEGER,
      reference_type TEXT,
      notes TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);

  // Customers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      birthday DATE,
      loyalty_points INTEGER DEFAULT 0,
      store_credit REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Sales table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      subtotal REAL NOT NULL,
      discount_percent REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      total REAL NOT NULL,
      status TEXT DEFAULT 'completed' CHECK(status IN ('completed', 'refunded', 'partial_refund')),
      cashier_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (cashier_id) REFERENCES users(id)
    );
  `);

  // Sale items table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      subtotal REAL NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);

  // Payments table
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      method TEXT NOT NULL CHECK(method IN ('cash', 'mpesa', 'card')),
      amount REAL NOT NULL,
      mpesa_receipt TEXT,
      mpesa_phone TEXT,
      mpesa_transaction_id TEXT,
      status TEXT DEFAULT 'completed' CHECK(status IN ('pending', 'completed', 'failed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
    );
  `);

  // Custom orders table
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      item_description TEXT NOT NULL,
      cake_design TEXT,
      flavor TEXT,
      size TEXT,
      total_price REAL NOT NULL,
      deposit_paid REAL DEFAULT 0,
      balance REAL NOT NULL,
      pickup_date DATETIME NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_production', 'ready', 'completed', 'cancelled')),
      notes TEXT,
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);

  // Suppliers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Purchases table
  db.exec(`
    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      total_amount REAL NOT NULL,
      payment_status TEXT DEFAULT 'pending' CHECK(payment_status IN ('pending', 'partial', 'paid')),
      amount_paid REAL DEFAULT 0,
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);

  // Purchase items table
  db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL,
      ingredient_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      unit_cost REAL NOT NULL,
      subtotal REAL NOT NULL,
      FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
      FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
    );
  `);

  // Purchase payments table (for split payments)
  db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      method TEXT NOT NULL CHECK(method IN ('cash', 'mpesa', 'bank_transfer', 'credit')),
      reference TEXT,
      notes TEXT,
      paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      recorded_by INTEGER,
      FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
      FOREIGN KEY (recorded_by) REFERENCES users(id)
    );
  `);

  // Production logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      quantity_produced INTEGER NOT NULL,
      cost_estimated REAL,
      waste_quantity REAL DEFAULT 0,
      notes TEXT,
      produced_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (produced_by) REFERENCES users(id)
    );
  `);

  // Expenses table
  db.exec(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL CHECK(category IN ('utilities', 'salaries', 'rent', 'transport', 'packaging', 'maintenance', 'other')),
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      expense_date DATE NOT NULL,
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);

  // Promotions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      discount_percent REAL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Devices table
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_name TEXT NOT NULL,
      device_identifier TEXT UNIQUE NOT NULL,
      device_type TEXT CHECK(device_type IN ('desktop', 'mobile', 'tablet', 'printer', 'scanner', 'pos_terminal', 'unknown')),
      device_category TEXT DEFAULT 'software' CHECK(device_category IN ('software', 'hardware')),
      browser TEXT,
      ip_address TEXT,
      user_id INTEGER,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'offline')),
      connection_type TEXT CHECK(connection_type IN ('wifi', 'ethernet', 'usb', 'bluetooth', 'unknown')),
      last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Notifications table
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT CHECK(type IN ('info', 'success', 'warning', 'error', 'device')),
      is_read INTEGER DEFAULT 0,
      action_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Branches table
  db.exec(`
    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      phone TEXT,
      manager_id INTEGER,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (manager_id) REFERENCES users(id)
    );
  `);

  // Transfers table (stock transfers between branches)
  db.exec(`
    CREATE TABLE IF NOT EXISTS transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_branch_id INTEGER NOT NULL,
      to_branch_id INTEGER NOT NULL,
      product_id INTEGER,
      items TEXT NOT NULL,
      quantity INTEGER,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'in_transit', 'completed', 'cancelled')),
      notes TEXT,
      requested_by INTEGER NOT NULL,
      approved_by INTEGER,
      date DATE DEFAULT CURRENT_DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (from_branch_id) REFERENCES branches(id),
      FOREIGN KEY (to_branch_id) REFERENCES branches(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (requested_by) REFERENCES users(id),
      FOREIGN KEY (approved_by) REFERENCES users(id)
    );
  `);

  // --- PAYROLL ENGINE TABLES ---

  // Payroll Settings (Global Config)
  db.exec(`
    CREATE TABLE IF NOT EXISTS payroll_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER DEFAULT 1,
      pay_frequency TEXT DEFAULT 'monthly' CHECK(pay_frequency IN ('monthly', 'weekly', 'biweekly')),
      currency TEXT DEFAULT 'KES',
      tax_rule_id INTEGER, -- Link to specific tax logic if needed
      overtime_enabled INTEGER DEFAULT 1,
      approval_required INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Payroll Components (Earnings, Deductions, Taxes)
  db.exec(`
    CREATE TABLE IF NOT EXISTS payroll_components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER DEFAULT 1,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('earning', 'deduction', 'tax', 'reimbursement')),
      calculation_type TEXT NOT NULL CHECK(calculation_type IN ('fixed', 'percentage', 'formula')),
      formula TEXT, -- Stores the math: "basic * 0.1" or "5000"
      active INTEGER DEFAULT 1,
      taxable INTEGER DEFAULT 1, -- Is this earning taxable?
      pensionable INTEGER DEFAULT 0, -- Does it count for pension?
      run_order INTEGER DEFAULT 0, -- Order of calculation
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Employee Payroll Data (Personalized Values)
  db.exec(`
    CREATE TABLE IF NOT EXISTS employee_payroll_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      basic_salary REAL DEFAULT 0,
      bank_name TEXT,
      account_number TEXT,
      tax_pin TEXT, -- KRA PIN
      nssf_number TEXT,
      nhif_number TEXT,
      payment_method TEXT DEFAULT 'bank' CHECK(payment_method IN ('bank', 'mpesa', 'cash', 'check')),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Payroll Runs (The Execution Layer)
  db.exec(`
    CREATE TABLE IF NOT EXISTS payroll_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER DEFAULT 1,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      run_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'pending_approval', 'approved', 'paid', 'locked')),
      total_gross REAL DEFAULT 0,
      total_net REAL DEFAULT 0,
      approved_by INTEGER,
      notes TEXT,
      FOREIGN KEY (approved_by) REFERENCES users(id)
    );
  `);

  // Payslips (Individual Records)
  db.exec(`
    CREATE TABLE IF NOT EXISTS payslips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payroll_run_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      basic_salary REAL NOT NULL,
      gross_pay REAL NOT NULL,
      total_deductions REAL NOT NULL,
      net_pay REAL NOT NULL,
      is_paid INTEGER DEFAULT 0,
      generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Payslip Items (Detailed Line Items)
  db.exec(`
    CREATE TABLE IF NOT EXISTS payslip_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payslip_id INTEGER NOT NULL,
      component_name TEXT NOT NULL,
      component_type TEXT NOT NULL, -- earning, deduction, etc
      amount REAL NOT NULL,
      FOREIGN KEY (payslip_id) REFERENCES payslips(id) ON DELETE CASCADE
    );
  `);

  // Payroll Audit Logs (Compliance)
  db.exec(`
    CREATE TABLE IF NOT EXISTS payroll_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL, -- "edit_component", "run_payroll"
      details TEXT, -- JSON details of change
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // --- SAAS FOUNDATION TABLES ---

  // Company Profile
  db.exec(`
    CREATE TABLE IF NOT EXISTS company_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      country TEXT,
      business_type TEXT CHECK(business_type IN ('bakery', 'retail', 'restaurant', 'pharmacy', 'supermarket', 'hardware', 'fleet')),
      setup_completed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // License Store
  db.exec(`
    CREATE TABLE IF NOT EXISTS license_store (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_key TEXT UNIQUE NOT NULL,
      issue_date DATETIME,
      expiry_date DATETIME,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'expired', 'revoked')),
      modules_enabled TEXT, -- JSON array of enabled modules
      last_verified_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // App Settings (Theming & Branding)
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      theme TEXT DEFAULT 'default' CHECK(theme IN ('default', 'win7')),
      primary_color TEXT DEFAULT '#000000',
      logo_path TEXT,
      receipt_footer_text TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // --- FLEET MANAGEMENT TABLES ---

  // Subscriptions table (Feature flags)
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      feature_name TEXT NOT NULL,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'expired', 'cancelled')),
      start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      payment_reference TEXT,
      auto_renew INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Drivers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS drivers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      license_number TEXT UNIQUE,
      phone TEXT,
      email TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'on_leave')),
      performance_score REAL DEFAULT 100,
      assigned_vehicle_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // GPS Devices table
  db.exec(`
    CREATE TABLE IF NOT EXISTS gps_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      imei TEXT UNIQUE NOT NULL,
      sim_number TEXT,
      device_type TEXT,
      firmware_version TEXT,
      last_ping DATETIME,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'offline')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Vehicles table
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plate_number TEXT UNIQUE NOT NULL,
      model TEXT,
      year INTEGER,
      color TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'maintenance', 'inactive')),
      driver_id INTEGER,
      gps_device_id INTEGER UNIQUE,
      fuel_type TEXT CHECK(fuel_type IN ('petrol', 'diesel', 'electric', 'hybrid')),
      last_service_date DATE,
      insurance_expiry DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (driver_id) REFERENCES drivers(id),
      FOREIGN KEY (gps_device_id) REFERENCES gps_devices(id)
    );
  `);

  // GPS Logs table (High volume)
  db.exec(`
    CREATE TABLE IF NOT EXISTS gps_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      vehicle_id INTEGER,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      speed REAL DEFAULT 0,
      heading REAL DEFAULT 0,
      ignition INTEGER DEFAULT 0,
      fuel_level REAL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES gps_devices(id),
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    );
  `);

  // Trips table
  db.exec(`
    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      driver_id INTEGER,
      start_time DATETIME NOT NULL,
      end_time DATETIME,
      start_location TEXT,
      end_location TEXT,
      distance_km REAL DEFAULT 0,
      fuel_consumed REAL DEFAULT 0,
      max_speed REAL DEFAULT 0,
      status TEXT DEFAULT 'ongoing' CHECK(status IN ('ongoing', 'completed', 'cancelled')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
      FOREIGN KEY (driver_id) REFERENCES drivers(id)
    );
  `);

  // Maintenance Records table
  db.exec(`
    CREATE TABLE IF NOT EXISTS maintenance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      service_type TEXT NOT NULL,
      description TEXT,
      cost REAL DEFAULT 0,
      service_date DATE NOT NULL,
      next_service_date DATE,
      performed_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    );
  `);
  // Check and add permissions column if missing (Migration)
  try { db.exec('ALTER TABLE users ADD COLUMN permissions TEXT'); } catch (_) { }
  try { db.exec('ALTER TABLE users ADD COLUMN last_login DATETIME'); } catch (_) { }

  // Devices table migrations
  try { db.exec("ALTER TABLE devices ADD COLUMN device_category TEXT DEFAULT 'software'"); } catch (_) { }
  try { db.exec("ALTER TABLE devices ADD COLUMN vendor_id TEXT"); } catch (_) { }
  try { db.exec("ALTER TABLE devices ADD COLUMN product_id TEXT"); } catch (_) { }
  try { db.exec("ALTER TABLE devices ADD COLUMN path TEXT"); } catch (_) { }
  try { db.exec("ALTER TABLE devices ADD COLUMN last_active DATETIME DEFAULT CURRENT_TIMESTAMP"); } catch (_) { }

  // Products table migrations
  try { db.exec("ALTER TABLE products ADD COLUMN emoji TEXT"); } catch (_) { }
  try { db.exec("ALTER TABLE products ADD COLUMN description TEXT"); } catch (_) { }

  // Activity Logs table (Migration)
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
  try { db.exec("ALTER TABLE activity_logs ADD COLUMN ip_address TEXT"); } catch (_) { }

  // --- NEW MODULES MIGRATIONS ---
  // Ensure payroll tables exist for legacy live databases
  db.exec(`
    CREATE TABLE IF NOT EXISTS payroll_components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER DEFAULT 1,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('earning', 'deduction', 'tax', 'reimbursement')),
      calculation_type TEXT NOT NULL CHECK(calculation_type IN ('fixed', 'percentage', 'formula')),
      formula TEXT,
      active INTEGER DEFAULT 1,
      taxable INTEGER DEFAULT 1,
      pensionable INTEGER DEFAULT 0,
      run_order INTEGER DEFAULT 0,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS employee_payroll_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      basic_salary REAL DEFAULT 0,
      bank_name TEXT,
      account_number TEXT,
      tax_pin TEXT,
      nssf_number TEXT,
      nhif_number TEXT,
      payment_method TEXT DEFAULT 'bank' CHECK(payment_method IN ('bank', 'mpesa', 'cash', 'check')),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS payroll_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER DEFAULT 1,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      run_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'approved', 'processed')),
      total_gross REAL DEFAULT 0,
      total_net REAL DEFAULT 0,
      approved_by INTEGER,
      FOREIGN KEY (approved_by) REFERENCES users(id)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS payslips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payroll_run_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      basic_salary REAL DEFAULT 0,
      gross_pay REAL DEFAULT 0,
      total_deductions REAL DEFAULT 0,
      net_pay REAL DEFAULT 0,
      FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS payslip_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payslip_id INTEGER NOT NULL,
      component_name TEXT NOT NULL,
      component_type TEXT NOT NULL,
      amount REAL NOT NULL,
      FOREIGN KEY (payslip_id) REFERENCES payslips(id)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS payroll_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER DEFAULT 1 UNIQUE,
      pay_frequency TEXT DEFAULT 'monthly' CHECK(pay_frequency IN ('weekly', 'bi-weekly', 'monthly')),
      currency TEXT DEFAULT 'KES',
      overtime_enabled INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log('✅ Database schema initialized');
}

// Seed initial data
// Ensure default system accounts always exist (runs on every startup)
export async function ensureDefaultUsers() {
  const defaults = [
    { username: 'admin', password: 'admin123', full_name: 'System Administrator', role: 'admin' },
    { username: 'dev', password: 'dev123', full_name: 'Developer Account', role: 'admin' },
  ];
  for (const u of defaults) {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(u.username);
    if (!existing) {
      const hash = await bcrypt.hash(u.password, 10);
      db.prepare(`INSERT INTO users (username, password_hash, full_name, role, status) VALUES (?, ?, ?, ?, 'approved')`)
        .run(u.username, hash, u.full_name, u.role);
      console.log(`✅ Default user ensured: ${u.username}`);
    }
  }
}

export async function seedDatabase() {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();

  if (userCount.count === 0) {
    console.log('🌱 Seeding initial data...');

    // Create default admin user
    const hashedPassword = await bcrypt.hash('admin123', 10);
    db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role, status)
      VALUES (?, ?, ?, ?, ?)
    `).run('admin', hashedPassword, 'System Administrator', 'admin', 'approved');

    // Create default dev user
    const devHash = await bcrypt.hash('dev123', 10);
    db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role, status)
      VALUES (?, ?, ?, ?, ?)
    `).run('dev', devHash, 'Developer Account', 'admin', 'approved');

    console.log('✅ Default users created: admin/admin123 and dev/dev123');

    // Create default categories
    const categories = [
      ['Bread', 'Fresh baked bread'],
      ['Cakes', 'Cakes and celebration items'],
      ['Pastries', 'Pastries and savory items'],
      ['Drinks', 'Beverages'],
      ['Snacks', 'Snacks and treats']
    ];

    const insertCategory = db.prepare('INSERT INTO categories (name, description) VALUES (?, ?)');
    categories.forEach(cat => insertCategory.run(cat));
    console.log('✅ Categories created');

    // Create sample ingredients
    const ingredients = [
      ['Flour', 'kg'],
      ['Sugar', 'kg'],
      ['Eggs', 'units'],
      ['Butter', 'kg'],
      ['Milk', 'liters'],
      ['Yeast', 'grams'],
      ['Salt', 'grams'],
      ['Baking Powder', 'grams'],
      ['Vanilla Extract', 'ml'],
      ['Cocoa Powder', 'grams']
    ];

    const insertIngredient = db.prepare('INSERT INTO ingredients (name, unit, low_stock_threshold) VALUES (?, ?, ?)');
    ingredients.forEach(ing => insertIngredient.run(ing[0], ing[1], 5));
    console.log('✅ Ingredients created');

    // Create sample products
    const products = [
      ['White Bread', 1, 60, null, '🍞'],
      ['Brown Bread', 1, 65, null, '🍞'],
      ['Milk Bread', 1, 70, null, '🥖'],
      ['Chocolate Cake', 2, 1500, null, '🎂'],
      ['Vanilla Cake', 2, 1200, null, '🎂'],
      ['Red Velvet', 2, 1800, null, '🍰'],
      ['Cupcake', 2, 150, null, '🧁'],
      ['Croissant', 3, 100, null, '🥐'],
      ['Meat Pie', 3, 100, null, '🥧'],
      ['Samosa', 3, 50, null, '🔺'],
      ['Doughnut', 3, 80, null, '🍩'],
      ['Sausage Roll', 3, 80, null, '🌯'],
      ['Juice 500ml', 4, 100, null, '🧃'],
      ['Tea', 4, 50, null, '☕'],
      ['Coffee', 4, 80, null, '☕'],
      ['Chin Chin', 5, 100, null, '🍪']
    ];

    const insertProduct = db.prepare('INSERT INTO products (name, category_id, price, barcode, emoji) VALUES (?, ?, ?, ?, ?)');
    products.forEach(prod => insertProduct.run(prod));
    console.log('✅ Products created');

    // Initialize inventory for all products
    const allProducts = db.prepare('SELECT id FROM products').all();
    const insertFinishedInventory = db.prepare('INSERT INTO inventory_finished (product_id, quantity) VALUES (?, ?)');
    allProducts.forEach(p => insertFinishedInventory.run(p.id, 50)); // Start with 50 units each
    console.log('✅ Finished goods inventory initialized');

    // Initialize raw materials inventory
    const allIngredients = db.prepare('SELECT id FROM ingredients').all();
    const insertRawInventory = db.prepare('INSERT INTO inventory_raw (ingredient_id, quantity) VALUES (?, ?)');
    allIngredients.forEach(i => insertRawInventory.run(i.id, 100)); // Start with 100 units each
    console.log('✅ Raw materials inventory initialized');

    // Create sample recipes (White Bread example)
    const whiteBreakProduct = db.prepare('SELECT id FROM products WHERE name = ?').get('White Bread');
    const flourIngredient = db.prepare('SELECT id FROM ingredients WHERE name = ?').get('Flour');
    const sugarIngredient = db.prepare('SELECT id FROM ingredients WHERE name = ?').get('Sugar');
    const yeastIngredient = db.prepare('SELECT id FROM ingredients WHERE name = ?').get('Yeast');

    if (whiteBreakProduct && flourIngredient) {
      db.prepare('INSERT INTO recipes (product_id, ingredient_id, quantity_required) VALUES (?, ?, ?)').run(whiteBreakProduct.id, flourIngredient.id, 0.5);
      db.prepare('INSERT INTO recipes (product_id, ingredient_id, quantity_required) VALUES (?, ?, ?)').run(whiteBreakProduct.id, sugarIngredient.id, 0.05);
      db.prepare('INSERT INTO recipes (product_id, ingredient_id, quantity_required) VALUES (?, ?, ?)').run(whiteBreakProduct.id, yeastIngredient.id, 10);
      console.log('✅ Sample recipes created');
    }

    console.log('🎉 Database seeding completed!');
  }

  // Initialize default app settings (Independent of user seeding)
  const settingsCount = db.prepare('SELECT COUNT(*) as count FROM app_settings').get();
  if (settingsCount.count === 0) {
    db.prepare(`
      INSERT INTO app_settings (theme, primary_color, receipt_footer_text)
      VALUES ('default', '#ea580c', 'Thank you for shopping with us!')
    `).run();
    console.log('✅ Default app settings initialized');
  }

  // Initialize default license (Independent of user seeding)
  const licenseCount = db.prepare('SELECT COUNT(*) as count FROM license_store').get();
  if (licenseCount.count === 0) {
    const defaultModules = JSON.stringify(['pos', 'inventory', 'reports', 'customers', 'suppliers', 'settings', 'fleet', 'payroll']);
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 10); // 10 years validity

    db.prepare(`
      INSERT INTO license_store (license_key, issue_date, expiry_date, status, modules_enabled, last_verified_at)
      VALUES (?, ?, ?, 'active', ?, CURRENT_TIMESTAMP)
    `).run('COMMUNITY-FREE-LICENSE', new Date().toISOString(), expiryDate.toISOString(), defaultModules);
    console.log('✅ Default community license initialized');
  }

  // ── Offline-First: Sync Queue ─────────────────────────────────────────────
  // Tracks every unsynced write so we can retry failed cloud pushes granularly.
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name   TEXT    NOT NULL,
      record_id    INTEGER NOT NULL,
      operation    TEXT    NOT NULL DEFAULT 'upsert',
      retry_count  INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT    DEFAULT (datetime('now')),
      last_attempt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sync_queue_table ON sync_queue(table_name, record_id);
  `);

  // ── Offline-First: Per-Record Sync Metadata ───────────────────────────────
  // ALTER TABLE is idempotent via try/catch — safe on both fresh and existing DBs.
  const metaTables = ['sales', 'products', 'customers', 'orders', 'expenses', 'purchases'];
  for (const t of metaTables) {
    try { db.exec(`ALTER TABLE ${t} ADD COLUMN sync_status TEXT DEFAULT 'pending'`); } catch (_) { }
    try { db.exec(`ALTER TABLE ${t} ADD COLUMN device_id   TEXT`); } catch (_) { }
    try { db.exec(`ALTER TABLE ${t} ADD COLUMN updated_at  TEXT DEFAULT (datetime('now'))`); } catch (_) { }
  }

  // ── Multi-Tenant Migrations ───────────────────────────────────────────────
  try { db.exec(`ALTER TABLE products ADD COLUMN company_id INTEGER DEFAULT 1`); } catch (_) { }
  try { db.exec(`ALTER TABLE categories ADD COLUMN company_id INTEGER DEFAULT 1`); } catch (_) { }
}

// Initialize on import
initializeDatabase();
await seedDatabase();

export default db;

