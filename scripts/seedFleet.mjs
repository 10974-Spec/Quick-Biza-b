/**
 * Fleet data seeder — run with: node scripts/seedFleet.mjs
 * Uses the app's db.js so the schema is initialized first.
 */
import db from '../database/db.js';

console.log('\n🚚 Seeding fleet simulation data...\n');

// ─── GPS Devices ──────────────────────────────────────────────────────────────
function upsertGps(imei, sim, status) {
    const ex = db.prepare('SELECT id FROM gps_devices WHERE imei = ?').get(imei);
    if (ex) return ex.id;
    return db.prepare(
        'INSERT INTO gps_devices (imei, sim_number, device_type, firmware_version, status, last_ping) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)'
    ).run(imei, sim, 'vehicle_tracker', '3.2.1', status).lastInsertRowid;
}
const GPS = [
    upsertGps('860001234567890', '0712000001', 'active'),
    upsertGps('860009876543210', '0712000002', 'active'),
    upsertGps('860005555000001', '0712000003', 'inactive'),
];
console.log('  ✅ GPS devices:', GPS);

// ─── Drivers ──────────────────────────────────────────────────────────────────
function upsertDriver(name, lic, phone, email, score) {
    const ex = db.prepare('SELECT id FROM drivers WHERE license_number = ?').get(lic);
    if (ex) return ex.id;
    return db.prepare(
        'INSERT INTO drivers (name, license_number, phone, email, status, performance_score) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, lic, phone, email, 'active', score).lastInsertRowid;
}
const DRV = [
    upsertDriver('Peter Kamau', 'DL-KA001', '+254712345678', 'peter@fleet.ke', 92),
    upsertDriver('Grace Wanjiku', 'DL-NA002', '+254723456789', 'grace@fleet.ke', 88),
    upsertDriver('James Otieno', 'DL-NB003', '+254734567890', 'james@fleet.ke', 79),
];
console.log('  ✅ Drivers:', DRV);

// ─── Vehicles ─────────────────────────────────────────────────────────────────
function upsertVehicle(plate, model, year, color, status, fuel, lastSvc, insExpiry, dIdx) {
    const ex = db.prepare('SELECT id FROM vehicles WHERE plate_number = ?').get(plate);
    if (ex) return ex.id;
    return db.prepare(
        'INSERT INTO vehicles (plate_number, model, year, color, status, driver_id, gps_device_id, fuel_type, last_service_date, insurance_expiry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(plate, model, year, color, status, DRV[dIdx], GPS[dIdx], fuel, lastSvc, insExpiry).lastInsertRowid;
}
const VEH = [
    upsertVehicle('KCB 123A', 'Toyota Hiace', 2020, 'White', 'active', 'diesel', '2026-01-15', '2026-12-31', 0),
    upsertVehicle('KDD 456B', 'Isuzu NPR', 2019, 'Silver', 'active', 'diesel', '2026-01-28', '2025-06-30', 1),
    upsertVehicle('KAA 789C', 'Toyota Fielder', 2022, 'Blue', 'maintenance', 'petrol', '2026-02-18', '2026-03-15', 2),
];
console.log('  ✅ Vehicles:', VEH);

// ─── Trips ────────────────────────────────────────────────────────────────────
const tStmt = db.prepare(
    'INSERT INTO trips (vehicle_id, driver_id, start_time, end_time, start_location, end_location, distance_km, fuel_consumed, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
const tripsData = [
    [0, 0, '2026-02-20 06:00:00', '2026-02-20 09:30:00', 'Nairobi CBD', 'Mombasa Rd Depot', 45.2, 6.8, 'completed'],
    [0, 0, '2026-02-20 10:00:00', '2026-02-20 12:00:00', 'Mombasa Rd Depot', 'Westlands', 22.5, 3.2, 'completed'],
    [1, 1, '2026-02-20 07:00:00', '2026-02-20 11:00:00', 'Nairobi CBD', 'Thika Rd Mall', 18.7, 2.9, 'completed'],
    [1, 1, '2026-02-20 14:00:00', null, 'Thika Rd', 'Karen', 0, 0, 'ongoing'],
    [2, 2, '2026-02-19 08:00:00', '2026-02-19 14:00:00', 'Nairobi CBD', 'Ngong Rd', 30.1, 5.5, 'completed'],
];
tripsData.forEach(([vi, di, st, et, sl, el, d, f, s]) => {
    try { tStmt.run(VEH[vi], DRV[di], st, et, sl, el, d, f, s); } catch (_) { }
});
console.log('  ✅ Trips:', db.prepare('SELECT COUNT(*) as c FROM trips').get().c);

// ─── Maintenance ──────────────────────────────────────────────────────────────
const mStmt = db.prepare(
    'INSERT INTO maintenance_records (vehicle_id, service_type, description, cost, service_date, next_service_date, performed_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
[
    [0, 'Oil Change', 'Regular 5000km service + filter', 3500, '2026-01-15', '2026-07-15', 'Toyota Kenya'],
    [0, 'Tire Rotation', 'Front/rear swap + balancing', 1200, '2026-02-01', '2026-08-01', 'Tyreking Nairobi'],
    [1, 'Brake Service', 'Front brake pads replacement', 8500, '2026-01-28', '2027-01-28', 'Isuzu Kenya'],
    [2, 'Engine Overhaul', 'Major engine + gasket work', 45000, '2026-02-18', '2028-02-18', 'AutoFix Garage'],
    [1, 'Tyre Replacement', 'All 4 tyres — Bridgestone 185/65', 12000, '2026-02-10', '2028-02-10', 'Tyreking Nairobi'],
].forEach(([vi, st, d, c, sd, nsd, by]) => {
    try { mStmt.run(VEH[vi], st, d, c, sd, nsd, by); } catch (_) { }
});
console.log('  ✅ Maintenance:', db.prepare('SELECT COUNT(*) as c FROM maintenance_records').get().c);

// ─── GPS Location Logs (simulate Nairobi → Westlands route) ──────────────────
const lStmt = db.prepare(
    'INSERT INTO gps_logs (device_id, vehicle_id, latitude, longitude, speed, heading, ignition, fuel_level, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
[
    [-1.2864, 36.8172, 0],
    [-1.2820, 36.8150, 45],
    [-1.2780, 36.8130, 52],
    [-1.2750, 36.8100, 60],
    [-1.2720, 36.8080, 55],
].forEach(([lat, lng, spd], i) => {
    const hr = String(8 + i).padStart(2, '0');
    try { lStmt.run(GPS[0], VEH[0], lat, lng, spd, 270, 1, 75 - i * 2, `2026-02-20 ${hr}:00:00`); } catch (_) { }
    try { lStmt.run(GPS[1], VEH[1], lat + 0.01, lng + 0.02, Math.max(0, spd - 5), 90, 1, 60 - i * 2, `2026-02-20 ${hr}:15:00`); } catch (_) { }
});
console.log('  ✅ GPS logs:', db.prepare('SELECT COUNT(*) as c FROM gps_logs').get().c);

console.log('\n✅ Fleet simulation complete!');
console.log(JSON.stringify({
    vehicles: db.prepare('SELECT COUNT(*) as c FROM vehicles').get().c,
    drivers: db.prepare('SELECT COUNT(*) as c FROM drivers').get().c,
    gps_devices: db.prepare('SELECT COUNT(*) as c FROM gps_devices').get().c,
    trips: db.prepare('SELECT COUNT(*) as c FROM trips').get().c,
    maintenance: db.prepare('SELECT COUNT(*) as c FROM maintenance_records').get().c,
    gps_logs: db.prepare('SELECT COUNT(*) as c FROM gps_logs').get().c,
}, null, 2));
