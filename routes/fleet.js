import express from 'express';
import { fleetService } from '../services/fleetService.js';
import db from '../database/db.js';

const router = express.Router();

// Middleware to check subscription
const checkSubscription = (req, res, next) => {
    // For now, simulate check or allow all admin
    // TODO: Implement actual subscription check
    next();
};

// --- VEHICLES ---
router.get('/vehicles', checkSubscription, (req, res) => {
    try {
        const vehicles = fleetService.getAllVehicles();
        res.json(vehicles);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/vehicles', checkSubscription, (req, res) => {
    try {
        const vehicle = fleetService.createVehicle(req.body);
        res.status(201).json(vehicle);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// --- DRIVERS ---
router.get('/drivers', checkSubscription, (req, res) => {
    try {
        const drivers = fleetService.getAllDrivers();
        res.json(drivers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/drivers', checkSubscription, (req, res) => {
    try {
        const driver = fleetService.createDriver(req.body);
        res.status(201).json(driver);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// --- DEVICES ---
router.get('/devices', checkSubscription, (req, res) => {
    try {
        const devices = fleetService.getAllDevices();
        res.json(devices);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/devices', checkSubscription, (req, res) => {
    try {
        const device = fleetService.registerDevice(req.body);
        res.status(201).json(device);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// --- GPS DATA INGESTION (Hardware Endpoint) ---
router.post('/gps/data', (req, res) => {
    const { deviceId, lat, lng, speed, heading, ignition, fuel } = req.body;

    // Need to resolve deviceId (IMEI) to internal ID first
    try {
        const device = db.prepare('SELECT id FROM gps_devices WHERE imei = ?').get(deviceId);

        if (!device) {
            // Allow simulation devices to pass through for visualization
            if (deviceId && deviceId.startsWith('SIM_')) {
                if (req.io) {
                    req.io.emit('fleet:location', {
                        id: deviceId,
                        vehicleId: deviceId,
                        plate_number: deviceId,
                        ...req.body
                    });
                }
                return res.json({ success: true, simulated: true });
            }
            // Optional: Auto-register device?
            return res.status(404).json({ error: 'Device not found' });
        }

        const result = fleetService.updateVehicleLocation(device.id, lat, lng, speed, heading, ignition, fuel);

        // Emit via WebSocket (to be implemented in server.js)
        if (req.io) {
            req.io.emit('fleet:location', { ...result, deviceId });
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- SUBSCRIPTION CHECK ---
router.get('/subscription/status', (req, res) => {
    // Mock response for now
    res.json({ active: true, plan: 'fleet_pro', expires: '2026-12-31' });
});

// --- MAINTENANCE ---
router.get('/maintenance', checkSubscription, (req, res) => {
    try {
        const records = fleetService.getMaintenance();
        res.json(records);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/maintenance', checkSubscription, (req, res) => {
    try {
        const record = fleetService.createMaintenance(req.body);
        res.status(201).json(record);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// --- REPORTS ---
router.get('/stats', checkSubscription, (req, res) => {
    try {
        const stats = fleetService.getFleetStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
