
import { exec } from 'child_process';
import util from 'util';
import db from '../database/db.js';
import printerFormatter from './printerFormatter.js';

const execAsync = util.promisify(exec);

let usb, HID, SerialPort;

// Try to load native modules
try {
    // Dynamic imports or require checks would be better in ESM if supported smoothly, 
    // but for now we'll rely on global availability or gracefully degrade.
} catch (e) {
    console.warn('Hardware modules not fully loaded:', e.message);
}

class HardwareService {
    constructor() {
        this.simulated = false;
        // Expose a promise so callers can await module readiness
        this._ready = this.initializeModules();
    }

    async initializeModules() {
        try {
            usb = (await import('usb')).default;
            HID = (await import('node-hid')).default;
            const serialportPkg = await import('serialport');
            SerialPort = serialportPkg.SerialPort;
            console.log('✅ Native hardware modules loaded');

            if (usb && usb.on) {
                usb.on('attach', () => this.scanAll().catch(() => { }));
                usb.on('detach', () => this.scanAll().catch(() => { }));
            }
        } catch (error) {
            console.warn('⚠️ Hardware modules unavailable, using simulation mode.', error.message);
            this.simulated = true;
        }
    }

    async printReport(reportType, reportData) {
        try {
            console.log(`🖨️ Printing ${reportType}...`);
            const buffer = await printerFormatter.generateReport(reportType, reportData);

            // Reuse existing device detection logic
            if (!usb) {
                console.warn('⚠️ No USB module, skipping physical print.');
                return;
            }

            const deviceList = usb.getDeviceList();
            if (deviceList.length === 0) {
                console.warn('⚠️ No USB devices found to print to.');
                return;
            }

            const printers = this.getStoredDevices().filter(d => d.device_type === 'printer' && d.status === 'active');
            let targetDevice = printers.length > 0 ? printers[0] : null;

            if (targetDevice) {
                console.log(`🖨️ Printing to ${targetDevice.device_name}`);
                this.writeToUsb(targetDevice, buffer);
            } else {
                console.log('⚠️ No printer configured. Report generated but not printed.');
            }

        } catch (error) {
            console.error('❌ Failed to print report:', error);
        }
    }

    async printReceipt(sale, cartItems) {
        try {
            console.log(`🖨️ Generating receipt for Sale #${sale.id}...`);
            const buffer = await printerFormatter.generateReceipt(sale, cartItems);

            // Getting USB devices from our connected list
            if (!usb) {
                console.warn('⚠️ No USB module, skipping physical print.');
                return;
            }

            const deviceList = usb.getDeviceList();
            if (deviceList.length === 0) {
                console.warn('⚠️ No USB devices found to print to.');
                return;
            }

            // Using mapped printer device type from scan
            const printers = this.getStoredDevices().filter(d => d.device_type === 'printer' && d.status === 'active');

            let targetDevice = printers.length > 0 ? printers[0] : null;

            if (!targetDevice) {
                console.log('⚠️ No active printer found in DB. Attempting to find any USB device...');
                // Fallback to first USB device if strict printer matching fails (Development/Testing convenience)
                // In production, strictly enforce device_type === 'printer'
                // For now, let's just log and skip to avoid crashing random USB devices
            }

            if (targetDevice) {
                console.log(`🖨️ Printing to ${targetDevice.device_name}`);
                this.writeToUsb(targetDevice, buffer);
            } else {
                console.log('⚠️ No printer configured. Receipt buffer generated but not sent.');
            }

        } catch (error) {
            console.error('❌ Failed to print receipt:', error);
        }
    }

    async writeToUsb(deviceInfo, buffer) {
        try {
            if (!usb) return;
            const vid = parseInt(deviceInfo.vendor_id, 16);
            const pid = parseInt(deviceInfo.product_id, 16);

            const device = usb.findByIds(vid, pid);
            if (!device) {
                console.error('Printer device not found in USB list');
                return;
            }

            device.open();

            // Find OutEndpoint
            let endpoint = null;
            for (const iface of device.interfaces) {
                iface.claim();
                for (const ep of iface.endpoints) {
                    if (ep.direction === 'out') {
                        endpoint = ep;
                        break;
                    }
                }
                if (endpoint) break;
            }

            if (endpoint) {
                endpoint.transfer(buffer, (err) => {
                    if (err) console.error('USB Write Error:', err);
                    else console.log('✅ Receipt data sent to printer');
                    // device.close(); // Keep open or close? usually close after job
                });
            } else {
                console.error('No OUT endpoint found on printer');
                device.close();
            }

        } catch (error) {
            console.error('Low-level USB write failed:', error);
        }
    }

    async scanAll() {
        // Wait for module loading to finish (handles async init race condition)
        try { await this._ready; } catch (_) { }

        if (this.simulated) {
            return this.getSimulatedDevices();
        }

        try {
            const devices = [];

            // 1. USB Devices
            try {
                if (usb) {
                    usb.getDeviceList().forEach(d => {
                        devices.push({
                            name: `USB Device ${d.deviceDescriptor.idVendor}:${d.deviceDescriptor.idProduct}`,
                            device_identifier: `USB_${d.deviceDescriptor.idVendor}_${d.deviceDescriptor.idProduct}`,
                            device_type: 'unknown',
                            vendor_id: d.deviceDescriptor.idVendor.toString(16),
                            product_id: d.deviceDescriptor.idProduct.toString(16),
                            connection_type: 'usb',
                            status: 'active'
                        });
                    });
                }
            } catch (e) { console.warn('USB scan skipped:', e.message); }

            // 2. HID Devices (Scanners, Keyboards)
            try {
                if (HID) {
                    HID.devices().forEach(d => {
                        const type = (d.usagePage === 1 && d.usage === 6) ? 'scanner' : 'unknown';
                        devices.push({
                            name: d.product || 'HID Device',
                            device_identifier: `HID_${d.vendorId}_${d.productId}_${d.path}`,
                            device_type: type,
                            vendor_id: d.vendorId.toString(16),
                            product_id: d.productId.toString(16),
                            path: d.path,
                            connection_type: 'usb',
                            status: 'active'
                        });
                    });
                }
            } catch (e) { console.warn('HID scan skipped:', e.message); }

            // 3. Serial Ports
            try {
                if (SerialPort) {
                    const ports = await SerialPort.list();
                    ports.forEach(p => {
                        devices.push({
                            name: `Serial ${p.path}`,
                            device_identifier: `SERIAL_${p.path}`,
                            device_type: 'scale',
                            path: p.path,
                            vendor_id: p.vendorId,
                            product_id: p.productId,
                            connection_type: 'serial',
                            status: 'active'
                        });
                    });
                }
            } catch (e) { console.warn('Serial scan skipped:', e.message); }

            // Fall back to simulated if no real hardware found
            if (devices.length === 0) {
                console.warn('⚠️  No hardware detected — showing simulated devices');
                return this.getSimulatedDevices();
            }

            await this.syncWithDatabase(devices);
            return this.getStoredDevices();

        } catch (outerErr) {
            console.error('scanAll error, falling back to simulated:', outerErr.message);
            return this.getSimulatedDevices();
        }
    }

    async getSimulatedDevices() {
        const mockDevices = [
            {
                name: 'Epson TM-T88V (Demo)',
                device_identifier: 'SIM_PRINTER_001',
                device_type: 'printer',
                connection_type: 'usb',
                status: 'active',
                vendor_id: '04b8',
                product_id: '0202'
            },
            {
                name: 'Honeywell Barcode Scanner (Demo)',
                device_identifier: 'SIM_SCANNER_001',
                device_type: 'scanner',
                connection_type: 'usb',
                status: 'active',
                vendor_id: '0c2e',
                product_id: '0b6a'
            },
            {
                name: 'Network Receipt Printer (Demo)',
                device_identifier: 'SIM_NET_PRINTER_001',
                device_type: 'printer',
                connection_type: 'ethernet',
                status: 'active',
                ip_address: '192.168.1.200',
                port: 9100
            }
        ];

        try {
            await this.syncWithDatabase(mockDevices);
        } catch (_) { }
        return this.getStoredDevices();
    }

    async syncWithDatabase(detectedDevices) {
        // 1. Mark all devices as offline initially (or check diff)
        // Better approach: Get all currently active devices from DB
        const storedDevices = this.getStoredDevices();
        const detectedIds = new Set(detectedDevices.map(d => d.device_identifier));

        // Mark missing devices as offline
        const deactivateStmt = db.prepare("UPDATE devices SET status = 'offline', last_active = CURRENT_TIMESTAMP WHERE device_identifier = ?");

        for (const storedDev of storedDevices) {
            if (!detectedIds.has(storedDev.device_identifier) && storedDev.status === 'active') {
                console.log(`🔌 Device disconnected: ${storedDev.device_name}`);
                deactivateStmt.run(storedDev.device_identifier);
            }
        }

        // 2. Upsert detected devices
        const stmt = db.prepare(`
            INSERT INTO devices (
                device_name, device_identifier, device_type, connection_type, 
                vendor_id, product_id, path, ip_address, port, status, last_active, device_category
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, 'hardware'
            )
            ON CONFLICT(device_identifier) DO UPDATE SET
                last_active = CURRENT_TIMESTAMP,
                status = 'active'
        `);

        for (const d of detectedDevices) {
            try {
                stmt.run(
                    d.name,
                    d.device_identifier,
                    d.device_type || 'unknown',
                    d.connection_type,
                    d.vendor_id,
                    d.product_id,
                    d.path,
                    d.ip_address,
                    d.port,
                );
            } catch (err) {
                console.error('Failed to sync device:', d.name, err.message);
            }
        }
    }

    getStoredDevices() {
        return db.prepare("SELECT * FROM devices WHERE device_category = 'hardware' ORDER BY last_active DESC").all();
    }
}

export default new HardwareService();
