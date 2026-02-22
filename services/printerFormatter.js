import { ThermalPrinter, PrinterTypes, CharacterSet, BreakLine } from 'node-thermal-printer';

class PrinterFormatter {
    constructor() {
        this.printer = new ThermalPrinter({
            type: PrinterTypes.EPSON, // Default to EPSON ESC/POS
            interface: 'tcp://xxx.xxx.xxx.xxx', // Placeholder, we will get buffer
            characterSet: CharacterSet.PC852_LATIN2,
            removeSpecialCharacters: false,
            lineCharacter: "=",
            options: {
                timeout: 5000
            }
        });
    }

    async printLogo() {
        try {
            // Path to logo - adjusted for production/dev environments
            // In production (AppImage), resources are in process.resourcesPath
            const path = await import('path');
            const fs = await import('fs');

            let logoPath = path.join(process.cwd(), 'frontend/public/logo.png');

            // Check if running in electron/packaged environment
            if (process.resourcesPath) {
                const potentialPath = path.join(process.resourcesPath, 'frontend/public/logo.png');
                if (fs.existsSync(potentialPath)) {
                    logoPath = potentialPath;
                }
            }

            if (fs.existsSync(logoPath)) {
                await this.printer.printImage(logoPath);
                this.printer.newLine();
            } else {
                console.warn('Logo file not found:', logoPath);
            }
        } catch (error) {
            console.error('Failed to print logo:', error);
        }
    }

    async generateReport(reportType, reportData) {
        this.printer.clear();

        // Logo
        await this.printLogo();

        // Header
        this.printer.alignCenter();
        this.printer.bold(true);
        this.printer.setTextSize(1, 1);
        this.printer.println("AROMA BAKERY");
        this.printer.setTextSize(0, 0);
        this.printer.println(reportType.toUpperCase());
        this.printer.println(`Date: ${new Date().toLocaleString()}`);
        this.printer.drawLine();
        this.printer.bold(false);
        this.printer.alignLeft();

        // Dynamic Content based on Report Type
        if (reportType === 'Sales Report' && reportData.totals) {
            this.printer.println(`Total Sales: KES ${reportData.totals.total_sales?.toLocaleString() || 0}`);
            this.printer.println(`Transactions: ${reportData.totals.total_transactions || 0}`);
            this.printer.println(`Avg Transaction: KES ${reportData.totals.avg_transaction?.toFixed(0) || 0}`);
            this.printer.drawLine();

            this.printer.tableCustom([
                { text: "Date", align: "LEFT", width: 0.3 },
                { text: "Txns", align: "CENTER", width: 0.2 },
                { text: "Sales", align: "RIGHT", width: 0.5 }
            ]);

            reportData.data?.forEach(row => {
                this.printer.tableCustom([
                    { text: row.date, align: "LEFT", width: 0.3 },
                    { text: row.total_transactions.toString(), align: "CENTER", width: 0.2 },
                    { text: row.total_sales.toLocaleString(), align: "RIGHT", width: 0.5 }
                ]);
            });

        } else if (reportType === 'Inventory Report' && reportData.totals) {
            this.printer.println(`Total Products: ${reportData.totals.total_products || 0}`);
            this.printer.println(`Stock Value: KES ${reportData.totals.total_stock_value?.toLocaleString() || 0}`);
            this.printer.println(`Low Stock Items: ${reportData.totals.low_stock_items || 0}`);
            this.printer.drawLine();

            this.printer.tableCustom([
                { text: "Item", align: "LEFT", width: 0.5 },
                { text: "Stk", align: "CENTER", width: 0.2 },
                { text: "Val", align: "RIGHT", width: 0.3 }
            ]);

            reportData.data?.slice(0, 50).forEach(row => { // Limit to 50 items for print
                this.printer.tableCustom([
                    { text: row.name.substring(0, 15), align: "LEFT", width: 0.5 },
                    { text: row.stock_level.toString(), align: "CENTER", width: 0.2 },
                    { text: row.stock_value.toLocaleString(), align: "RIGHT", width: 0.3 }
                ]);
            });
            if (reportData.data?.length > 50) this.printer.println(`...and ${reportData.data.length - 50} more items`);

        } else if (reportType === 'Dashboard') {
            const { summary, lowStockAlerts, recentSales } = reportData;

            this.printer.println("--- TODAY'S SUMMARY ---");
            this.printer.println(`Sales Count: ${summary?.total_sales || 0}`);
            this.printer.println(`Revenue: KES ${summary?.total_revenue?.toLocaleString() || 0}`);
            this.printer.println(`Discounts: KES ${summary?.total_discounts?.toLocaleString() || 0}`);
            this.printer.drawLine();

            if (summary?.payment_breakdown?.length) {
                this.printer.println("Payment Modes:");
                summary.payment_breakdown.forEach(p => {
                    this.printer.tableCustom([
                        { text: p.method, align: "LEFT", width: 0.5 },
                        { text: p.count.toString(), align: "CENTER", width: 0.2 },
                        { text: p.total.toLocaleString(), align: "RIGHT", width: 0.3 }
                    ]);
                });
                this.printer.drawLine();
            }

            if (lowStockAlerts?.finished_goods?.length) {
                this.printer.println("!! LOW STOCK ALERTS !!");
                lowStockAlerts.finished_goods.slice(0, 5).forEach(item => {
                    this.printer.println(`- ${item.name}: ${item.quantity} left`);
                });
                this.printer.drawLine();
            }

            if (recentSales?.length) {
                this.printer.println("Recent Transactions:");
                this.printer.tableCustom([
                    { text: "Time", align: "LEFT", width: 0.35 },
                    { text: "By", align: "LEFT", width: 0.25 },
                    { text: "Amt", align: "RIGHT", width: 0.4 }
                ]);
                recentSales.slice(0, 5).forEach(sale => {
                    const time = new Date(sale.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    this.printer.tableCustom([
                        { text: time, align: "LEFT", width: 0.35 },
                        { text: sale.cashier_name.substring(0, 8), align: "LEFT", width: 0.25 },
                        { text: sale.total.toLocaleString(), align: "RIGHT", width: 0.4 }
                    ]);
                });
            }

        } else if (reportType === 'Product Performance' && reportData.data) {
            this.printer.tableCustom([
                { text: "Item", align: "LEFT", width: 0.5 },
                { text: "Qty", align: "CENTER", width: 0.2 },
                { text: "Rev", align: "RIGHT", width: 0.3 }
            ]);

            reportData.data?.slice(0, 20).forEach(row => {
                this.printer.tableCustom([
                    { text: row.name.substring(0, 15), align: "LEFT", width: 0.5 },
                    { text: row.total_quantity.toString(), align: "CENTER", width: 0.2 },
                    { text: row.total_revenue.toLocaleString(), align: "RIGHT", width: 0.3 }
                ]);
            });
        }
        else {
            this.printer.println("Detailed report data available in dashboard.");
        }

        // Footer
        this.printer.println("");
        this.printer.alignCenter();
        this.printer.println("--- End of Report ---");
        this.printer.cut();

        return this.printer.getBuffer();
    }

    async generateReceipt(sale, cartItems) {
        this.printer.clear();

        // Logo
        await this.printLogo();

        // Header
        this.printer.alignCenter();
        this.printer.bold(true);
        this.printer.setTextSize(1, 1);
        this.printer.println("AROMA BAKERY");
        this.printer.bold(false);
        this.printer.setTextSize(0, 0);
        this.printer.println("Delicious Moments, Baked Fresh");
        this.printer.println("Tel: +254 700 000 000");
        this.printer.drawLine();

        // Transaction Details
        this.printer.alignLeft();
        this.printer.println(`Receipt #: ${sale.receipt_number || sale.id}`);
        this.printer.println(`Date: ${new Date(sale.created_at).toLocaleString()}`);
        this.printer.println(`Server: ${sale.user_name || 'Admin'}`);
        this.printer.println(`Payment: ${sale.payment_method?.toUpperCase() || 'CASH'}`);
        this.printer.drawLine();

        // Items
        this.printer.tableCustom([
            { text: "Item", align: "LEFT", width: 0.5 },
            { text: "Qty", align: "CENTER", width: 0.15 },
            { text: "Total", align: "RIGHT", width: 0.35 }
        ]);

        cartItems.forEach(item => {
            this.printer.tableCustom([
                { text: item.product_name, align: "LEFT", width: 0.5 },
                { text: item.quantity.toString(), align: "CENTER", width: 0.15 },
                { text: (item.price * item.quantity).toLocaleString(), align: "RIGHT", width: 0.35 }
            ]);
        });

        this.printer.drawLine();

        // Totals
        this.printer.alignRight();
        this.printer.println(`Total: KES ${(sale.total || 0).toLocaleString()}`);
        if (sale.amount_tendered) {
            this.printer.println(`Cash: KES ${sale.amount_tendered.toLocaleString()}`);
            this.printer.println(`Change: KES ${(sale.amount_tendered - (sale.total || 0)).toLocaleString()}`);
        }

        // Footer
        this.printer.alignCenter();
        this.printer.drawLine();
        this.printer.println("Thank you for shopping with us!");
        this.printer.println("Karibu Tena!");
        this.printer.println("Powered by QuickBizaPOS");

        this.printer.cut();

        return this.printer.getBuffer();
    }
}

export default new PrinterFormatter();
