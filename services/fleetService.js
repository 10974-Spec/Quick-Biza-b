import db from '../database/db.js';

export const fleetService = {
  // --- VEHICLES ---
  getAllVehicles: () => {
    return db.prepare(`
      SELECT v.*, d.name as driver_name, g.imei as gps_imei, g.last_ping, g.status as gps_status
      FROM vehicles v
      LEFT JOIN drivers d ON v.driver_id = d.id
      LEFT JOIN gps_devices g ON v.gps_device_id = g.id
    `).all();
  },

  createVehicle: (data) => {
    const stmt = db.prepare(`
      INSERT INTO vehicles (plate_number, model, year, color, driver_id, gps_device_id, fuel_type, insurance_expiry)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      data.plate_number,
      data.model,
      data.year,
      data.color,
      data.driver_id,
      data.gps_device_id,
      data.fuel_type,
      data.insurance_expiry
    );
    return { id: info.lastInsertRowid, ...data };
  },

  updateVehicleLocation: (gpsDeviceId, lat, lng, speed, heading, ignition, fuelLevel) => {
    // 1. Log the raw data
    // 2. Update the vehicle/device status

    // Find vehicle by GPS ID
    const vehicle = db.prepare('SELECT id FROM vehicles WHERE gps_device_id = ?').get(gpsDeviceId);

    // Insert log
    db.prepare(`
      INSERT INTO gps_logs (device_id, vehicle_id, latitude, longitude, speed, heading, ignition, fuel_level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(gpsDeviceId, vehicle ? vehicle.id : null, lat, lng, speed, heading, ignition, fuelLevel);

    // Update Device Last Ping
    db.prepare(`
      UPDATE gps_devices SET last_ping = CURRENT_TIMESTAMP, status = 'active' WHERE id = ?
    `).run(gpsDeviceId);

    return { vehicleId: vehicle ? vehicle.id : null, lat, lng };
  },

  // --- DRIVERS ---
  getAllDevices: () => {
    try {
      return db.prepare('SELECT * FROM gps_devices').all();
    } catch (error) {
      console.error("Error fetching GPS devices:", error);
      return [];
    }
  },

  getAllDrivers: () => {
    return db.prepare('SELECT * FROM drivers').all();
  },

  createDriver: (data) => {
    const stmt = db.prepare(`
      INSERT INTO drivers (name, license_number, phone, email)
      VALUES (?, ?, ?, ?)
    `);
    const info = stmt.run(data.name, data.license_number, data.phone, data.email);
    return { id: info.lastInsertRowid, ...data };
  },

  // --- TRIPS (Basic) ---
  startTrip: (vehicleId, driverId, startLocation) => {
    const stmt = db.prepare(`
      INSERT INTO trips (vehicle_id, driver_id, start_time, start_location, status)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?, 'ongoing')
    `);
    return stmt.run(vehicleId, driverId, startLocation);
  },

  endTrip: (tripId, endLocation, distance, fuelConsumed) => {
    const stmt = db.prepare(`
      UPDATE trips 
      SET end_time = CURRENT_TIMESTAMP, end_location = ?, distance_km = ?, fuel_consumed = ?, status = 'completed'
      WHERE id = ?
    `);
    return stmt.run(endLocation, distance, fuelConsumed, tripId);
  },
  // --- MAINTENANCE ---
  createMaintenance: (data) => {
    const stmt = db.prepare(`
      INSERT INTO maintenance_records (vehicle_id, service_type, cost, description, date)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(data.vehicle_id, data.service_type, data.cost, data.description, data.date);
    return { id: info.lastInsertRowid, ...data };
  },

  getMaintenance: () => {
    try {
      const records = db.prepare(`
        SELECT m.*, v.plate_number 
        FROM maintenance_records m 
        JOIN vehicles v ON m.vehicle_id = v.id 
        ORDER BY m.date DESC
      `).all();
      return records;
    } catch (error) {
      console.error("Error fetching maintenance records:", error);
      return [];
    }
  },

  // --- REPORTS ---
  getFleetStats: () => {
    const vehicles = db.prepare('SELECT COUNT(*) as count FROM vehicles').get();
    const drivers = db.prepare('SELECT COUNT(*) as count FROM drivers').get();
    const trips = db.prepare('SELECT COUNT(*) as count, SUM(distance_km) as distance FROM trips').get();
    const maintenance = db.prepare('SELECT SUM(cost) as total_cost FROM maintenance_records').get();

    return {
      total_vehicles: vehicles.count,
      total_drivers: drivers.count,
      total_trips: trips.count,
      total_distance: trips.distance || 0,
      maintenance_cost: maintenance.total_cost || 0
    };
  }
};
