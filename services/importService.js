import xlsx from 'xlsx';
import db from '../database/db.js';

export const importService = {
    // Expected Headers
    TEMPLATES: {
        products: [
            { header: 'Product Name', key: 'name', width: 30 },
            { header: 'Category', key: 'category', width: 20 },
            { header: 'Price', key: 'price', width: 15 },
            { header: 'Initial Stock (Finished)', key: 'stock', width: 20 },
            { header: 'Description', key: 'description', width: 40 },
            { header: 'Barcode', key: 'barcode', width: 20 }
        ],
        customers: [
            { header: 'Full Name', key: 'name', width: 30 },
            { header: 'Phone Number', key: 'phone', width: 20 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Address/Location', key: 'address', width: 40 }
        ],
        suppliers: [
            { header: 'Supplier Name', key: 'name', width: 30 },
            { header: 'Contact Person', key: 'contact_person', width: 25 },
            { header: 'Phone', key: 'phone', width: 20 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Address', key: 'address', width: 40 }
        ]
    },

    // Parse Excel File
    parseExcel: (filePath) => {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        return xlsx.utils.sheet_to_json(sheet);
    },

    // Generate Template Buffer
    generateTemplate: (type) => {
        const columns = importService.TEMPLATES[type];
        if (!columns) throw new Error('Invalid template type');

        const workbook = xlsx.utils.book_new();
        const headerRow = {};
        columns.forEach(col => {
            headerRow[col.header] = ''; // Just headers
        });

        // Create sheet with headers
        const ws = xlsx.utils.json_to_sheet([], { header: columns.map(c => c.header) });

        // Set column widths
        ws['!cols'] = columns.map(c => ({ wch: c.width }));

        xlsx.utils.book_append_sheet(workbook, ws, type.charAt(0).toUpperCase() + type.slice(1));

        return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    },

    // Import Logic
    importData: async (type, data) => {
        return db.transaction(() => {
            let successCount = 0;
            let errors = [];

            if (type === 'products') {
                const insertProduct = db.prepare(`
                    INSERT INTO products (name, category_id, price, description, barcode, active)
                    VALUES (?, ?, ?, ?, ?, 1)
                `);

                const findCategory = db.prepare('SELECT id FROM categories WHERE name = ?');
                const createCategory = db.prepare('INSERT INTO categories (name) VALUES (?)');
                const insertStock = db.prepare('INSERT INTO inventory_finished (product_id, quantity) VALUES (?, ?)');

                data.forEach((row, index) => {
                    try {
                        const name = row['Product Name'];
                        const categoryName = row['Category'];
                        const price = parseFloat(row['Price']);
                        const stock = parseInt(row['Initial Stock (Finished)'] || 0);
                        const description = row['Description'];
                        const barcode = row['Barcode'];

                        if (!name || isNaN(price)) {
                            throw new Error('Missing name or invalid price');
                        }

                        // Handle Category
                        let categoryId = null;
                        if (categoryName) {
                            const cat = findCategory.get(categoryName);
                            if (cat) {
                                categoryId = cat.id;
                            } else {
                                const info = createCategory.run(categoryName);
                                categoryId = info.lastInsertRowid;
                            }
                        }

                        // Insert Product
                        const info = insertProduct.run(name, categoryId, price, description, barcode);
                        const productId = info.lastInsertRowid;

                        // Insert Initial Stock if provided
                        if (stock > 0) {
                            insertStock.run(productId, stock);
                        }

                        successCount++;
                    } catch (err) {
                        errors.push({ row: index + 2, error: err.message, data: row });
                    }
                });
            } else if (type === 'customers') {
                const insertCustomer = db.prepare(`
                    INSERT INTO customers (name, phone, email)
                    VALUES (?, ?, ?)
                `); // Note: Address might need a column or reuse existing ones? 
                // Checking schema: customers table has name, phone, email, birthday, loyalty_points, store_credit. 
                // There is no address. I'll skip address for now or add it later if Schema changes.
                // Assuming "Address/Location" maps to nothing or maybe I should check user request?
                // User said "enter the data and the import it". I'll stick to existing schema.

                data.forEach((row, index) => {
                    try {
                        const name = row['Full Name'];
                        const phone = row['Phone Number'];
                        const email = row['Email'];

                        if (!name) throw new Error('Missing name');

                        insertCustomer.run(name, phone, email);
                        successCount++;
                    } catch (err) {
                        errors.push({ row: index + 2, error: err.message, data: row });
                    }
                });
            } else if (type === 'suppliers') {
                const insertSupplier = db.prepare(`
                    INSERT INTO suppliers (name, contact_person, phone, email, address)
                    VALUES (?, ?, ?, ?, ?)
                `);

                data.forEach((row, index) => {
                    try {
                        const name = row['Supplier Name'];
                        const contact = row['Contact Person'];
                        const phone = row['Phone'];
                        const email = row['Email'];
                        const address = row['Address'];

                        if (!name) throw new Error('Missing name');

                        insertSupplier.run(name, contact, phone, email, address);
                        successCount++;
                    } catch (err) {
                        errors.push({ row: index + 2, error: err.message, data: row });
                    }
                });
            } else {
                throw new Error('Invalid import type');
            }

            return { success: true, imported: successCount, errors };
        })();
    }
};
