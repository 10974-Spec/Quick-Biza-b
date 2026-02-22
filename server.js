import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import productsRoutes from './routes/products.js';
import salesRoutes from './routes/sales.js';
import paymentsRoutes from './routes/payments.js';
import inventoryRoutes from './routes/inventory.js';
import ordersRoutes from './routes/orders.js';
import customersRoutes from './routes/customers.js';
import suppliersRoutes from './routes/suppliers.js';
import purchasesRoutes from './routes/purchases.js';
import expensesRoutes from './routes/expenses.js';
import promotionsRoutes from './routes/promotions.js';
import usersRoutes from './routes/users.js';
import branchesRoutes from './routes/branches.js';
import transfersRoutes from './routes/transfers.js';
import reportsRoutes from './routes/reports.js';
import devicesRoutes from './routes/devices.js';
import notificationsRoutes from './routes/notifications.js';
import hardwareRoutes from './routes/hardware.js';
import returnsRoutes from './routes/returns.js';
import productionRoutes from './routes/production.js';
import db, { initializeDatabase, seedDatabase, ensureDefaultUsers } from './database/db.js';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// Load environment variables
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import fleetRoutes from './routes/fleet.js';
import setupRoutes from './routes/setup.js';
import settingsRoutes from './routes/settings.js';
import importRoutes from './routes/import.js';
import payrollRoutes from './routes/payroll.js';
import uploadRoutes from './routes/upload.js';
import rolesRoutes from './routes/roles.js';
import feedbackRoutes from './routes/feedback.js';
import syncRoutes from './routes/sync.js';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { connectCloudDB } from './database/cloud.js';
import { startSyncScheduler, syncState } from './services/syncService.js';

// Connect to Cloud DB (MongoDB)
connectCloudDB();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Security hardening
app.use(helmet({ contentSecurityPolicy: false }));
app.disable('x-powered-by');

// Rate limiting: max 10 auth attempts per minute per IP
const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Too many login attempts. Please wait 60 seconds.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Attach io to request for use in routes
app.use((req, res, next) => {
    req.io = io;
    next();
});

const PORT = process.env.PORT || 3000;

// Middleware
const allowedOrigins = [
    'http://localhost:8080',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
    'http://localhost:5000',
    'https://quickbiza.vercel.app',
    'https://quickbiza-web.vercel.app',
    'app://',
];
app.use(cors({
    origin: '*', // Forcefully allow ALL origins to bypass any strict browser preflight checks
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));

// Pre-flight OPTIONS handler for all routes
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging — only in development to avoid exposing server internals
if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
        next();
    });
}

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes — apply rate limiter to auth
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/purchases', purchasesRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/promotions', promotionsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/branches', branchesRoutes);
app.use('/api/transfers', transfersRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/hardware', hardwareRoutes);
app.use('/api/returns', returnsRoutes);
app.use('/api/fleet', fleetRoutes);
app.use('/api/setup', setupRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/import', importRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api/sync', syncRoutes);

// Serve uploads
const uploadDir = process.env.USER_DATA_PATH
    ? path.join(process.env.USER_DATA_PATH, 'uploads')
    : path.join(__dirname, '../uploads');
app.use('/uploads', express.static(uploadDir));

// Categories endpoint
app.get('/api/categories', (req, res) => {
    try {
        const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
        res.json(categories);
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

app.post('/api/categories', (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Category name is required' });
        }

        const stmt = db.prepare('INSERT INTO categories (name, description) VALUES (?, ?)');
        const info = stmt.run(name, description || '');

        res.status(201).json({
            id: info.lastInsertRowid,
            name,
            description
        });
    } catch (error) {
        console.error('Error creating category:', error);
        res.status(500).json({ error: 'Failed to create category' });
    }
});

// ─── Sync Status Endpoint ─────────────────────────────────────────────────────
app.get('/api/sync/status', (_req, res) => {
    res.json({
        status: syncState.status,
        lastSyncAt: syncState.lastSyncAt,
        recordsSynced: syncState.recordsSynced,
        lastSyncError: syncState.lastSyncError,
        company_id: syncState.company_id,
    });
});

// Serve frontend static files
const frontendDistPath = path.join(__dirname, '../frontend/dist');
console.log('Serving frontend from:', frontendDistPath);
app.use(express.static(frontendDistPath));

// Handle SPA routing for non-API routes
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(frontendDistPath, 'index.html'));
    } else {
        res.status(404).json({ error: 'API route not found' });
    }
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Socket.IO connection
io.on('connection', (socket) => {
    console.log('Client connected to WebSocket');

    socket.on('disconnect', () => {
        console.log('Client disconnected from WebSocket');
    });
});


// Start server — bind to 127.0.0.1 for stable local Windows resolution, but 0.0.0.0 in cloud production
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
httpServer.listen(PORT, HOST, () => {
    if (process.env.NODE_ENV !== 'production') {
        console.log(`🚀 QuickBiza POS backend on http://${HOST}:${PORT}`);
    }
    // Ensure default system users exist (admin + dev) on every startup
    ensureDefaultUsers().catch(e => console.error('ensureDefaultUsers error:', e));
    // Start cloud sync scheduler
    startSyncScheduler();
    // Auto-scan hardware devices after a short delay
    setTimeout(() => {
        import('./services/hardware.js').then(m => {
            m.default.scanAll().then(devices => {
                if (devices.length) console.log(`🔌 Auto-scan found ${devices.length} device(s)`);
            }).catch(() => { });
        }).catch(() => { });
    }, 3000);
});

export default app;
