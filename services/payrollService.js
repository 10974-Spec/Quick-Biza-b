import db from '../database/db.js';

/**
 * Payroll Service
 * Handles formula parsing, validation, and payroll execution.
 */

// Safe math evaluation
// We do NOT use eval() for security. We use a simple parser or limited scope.
// For this engine, we will support basic arithmetic: +, -, *, /, (, )
// And variables: basic_salary, gross_pay, taxable_income
const evaluateFormula = (formula, context) => {
    try {
        // 1. Replace variables with values
        let parsed = formula;

        // Sort keys by length desc to avoid replacing substrings (e.g. "tax" inside "tax_relief")
        const variables = Object.keys(context).sort((a, b) => b.length - a.length);

        for (const v of variables) {
            // regex to replace word boundary to ensure exact match
            const regex = new RegExp(`\\b${v}\\b`, 'g');
            parsed = parsed.replace(regex, context[v]);
        }

        // 2. Security Check: Allow only numbers, operators, and parenthesis
        if (/[^0-9+\-*/().\s]/.test(parsed)) {
            console.error('Unsafe characters in formula:', parsed);
            return 0; // Fail safe
        }

        // 3. Evaluate safely
        // distinct Function constructor is safer than eval but still needs sanitization above
        return new Function(`return ${parsed}`)();
    } catch (e) {
        console.error('Formula evaluation error:', e, formula);
        return 0;
    }
};

const PayrollService = {
    /**
     * Get or Create Payroll Settings for a company
     */
    getSettings: (companyId = 1) => {
        let settings = db.prepare('SELECT * FROM payroll_settings WHERE company_id = ?').get(companyId);
        if (!settings) {
            db.prepare('INSERT INTO payroll_settings (company_id) VALUES (?)').run(companyId);
            settings = db.prepare('SELECT * FROM payroll_settings WHERE company_id = ?').get(companyId);
        }
        return settings;
    },

    /**
     * Update Payroll Settings
     */
    updateSettings: (companyId, data) => {
        const { pay_frequency, currency, overtime_enabled } = data;
        db.prepare(`
            UPDATE payroll_settings 
            SET pay_frequency = ?, currency = ?, overtime_enabled = ?, updated_at = CURRENT_TIMESTAMP
            WHERE company_id = ?
        `).run(pay_frequency, currency, overtime_enabled ? 1 : 0, companyId);
        return PayrollService.getSettings(companyId);
    },

    /**
     * Get all components
     */
    getComponents: (companyId = 1) => {
        return db.prepare('SELECT * FROM payroll_components WHERE company_id = ? ORDER BY run_order ASC').all(companyId);
    },

    /**
     * Add/Edit Component
     */
    saveComponent: (data) => {
        const { id, company_id, name, type, calculation_type, formula, active, taxable } = data;

        if (id) {
            db.prepare(`
                UPDATE payroll_components 
                SET name = ?, type = ?, calculation_type = ?, formula = ?, active = ?, taxable = ?
                WHERE id = ?
            `).run(name, type, calculation_type, formula || '', active ? 1 : 0, taxable ? 1 : 0, id);
            return { id, ...data };
        } else {
            const result = db.prepare(`
                INSERT INTO payroll_components (company_id, name, type, calculation_type, formula, active, taxable)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(company_id || 1, name, type, calculation_type, formula || '', active ? 1 : 0, taxable ? 1 : 0);
            return { id: result.lastInsertRowid, ...data };
        }
    },

    /**
     * Get Employee Payroll Data
     */
    getEmployeeData: (userId) => {
        let data = db.prepare('SELECT * FROM employee_payroll_data WHERE user_id = ?').get(userId);
        if (!data) {
            // Create default
            db.prepare('INSERT INTO employee_payroll_data (user_id) VALUES (?)').run(userId);
            data = db.prepare('SELECT * FROM employee_payroll_data WHERE user_id = ?').get(userId);
        }
        // Join with user table for name
        const user = db.prepare('SELECT full_name, role, email, phone, profile_picture FROM users WHERE id = ?').get(userId);
        return { ...data, ...user };
    },

    /**
     * Get All Employees Payroll Data
     */
    getAllEmployeesData: () => {
        try {
            // Get all active users
            const users = db.prepare("SELECT id, full_name, role, email, phone, profile_picture FROM users WHERE status = 'approved'").all();
            const results = [];

            for (const user of users) {
                let data = db.prepare('SELECT * FROM employee_payroll_data WHERE user_id = ?').get(user.id);
                if (!data) {
                    // Create default if missing
                    db.prepare('INSERT INTO employee_payroll_data (user_id) VALUES (?)').run(user.id);
                    data = db.prepare('SELECT * FROM employee_payroll_data WHERE user_id = ?').get(user.id);
                }
                results.push({ ...data, ...user });
            }
            return results;
        } catch (error) {
            console.error('\n[PayrollService Error] getAllEmployeesData failed:\n', error.message, error.stack, '\n');
            throw error;
        }
    },

    /**
     * Update Employee Data
     */
    updateEmployeeData: (userId, data) => {
        // Ensure record exists
        const exists = db.prepare('SELECT 1 FROM employee_payroll_data WHERE user_id = ?').get(userId);
        if (!exists) {
            db.prepare('INSERT INTO employee_payroll_data (user_id) VALUES (?)').run(userId);
        }

        const { basic_salary, bank_name, account_number, tax_pin, nssf_number, nhif_number, email, phone, profile_picture, full_name, role } = data;

        // Update Payroll Data
        db.prepare(`
            UPDATE employee_payroll_data 
            SET basic_salary = ?, bank_name = ?, account_number = ?, tax_pin = ?, nssf_number = ?, nhif_number = ?, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
        `).run(basic_salary, bank_name, account_number, tax_pin, nssf_number, nhif_number, userId);

        // Update User Data (Profile)
        if (email !== undefined || phone !== undefined || profile_picture !== undefined || full_name !== undefined || role !== undefined) {
            // Fetch current to avoid overwriting with undefined if partial update (though we usually send full obj)
            // simplified: update what is provided
            const sets = [];
            const vals = [];
            if (email !== undefined) { sets.push('email = ?'); vals.push(email); }
            if (phone !== undefined) { sets.push('phone = ?'); vals.push(phone); }
            if (profile_picture !== undefined) { sets.push('profile_picture = ?'); vals.push(profile_picture); }
            if (full_name !== undefined) { sets.push('full_name = ?'); vals.push(full_name); }
            if (role !== undefined) { sets.push('role = ?'); vals.push(role); }

            if (sets.length > 0) {
                vals.push(userId);
                db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
            }
        }

        return PayrollService.getEmployeeData(userId);
    },

    /**
     * SIMULATE PAYROLL
     * Does calculations but doesn't save runs.
     */
    simulatePayroll: (employeeIds) => {
        const results = [];
        const components = PayrollService.getComponents(1); // Default company for now

        for (const userId of employeeIds) {
            const empData = PayrollService.getEmployeeData(userId);
            if (!empData) continue;

            const basic = empData.basic_salary || 0;
            const context = {
                basic_salary: basic,
                gross_pay: basic, // accumulates
                taxable_income: basic // accumulates
            };

            const payslipItems = [];

            // 1. Process Earnings
            const earnings = components.filter(c => c.type === 'earning' && c.active);
            for (const comp of earnings) {
                let amount = 0;
                if (comp.calculation_type === 'fixed') {
                    amount = parseFloat(comp.formula || 0);
                } else if (comp.calculation_type === 'percentage') {
                    // e.g. 10 means 10% of basic
                    const pct = parseFloat(comp.formula || 0);
                    amount = basic * (pct / 100);
                } else if (comp.calculation_type === 'formula') {
                    amount = evaluateFormula(comp.formula, context);
                }

                if (amount > 0) {
                    context.gross_pay += amount;
                    if (comp.taxable) context.taxable_income += amount;
                    payslipItems.push({ name: comp.name, type: 'earning', amount });
                }
            }

            // 2. Process Deductions (Pre-Tax?) - For simplicity, assumed post-gross, pre-net
            // TO-DO: Implement Pre-Tax vs Post-Tax distinction logic if needed excessively
            // Standard PAYE/NSSF/NHIF logic usually goes here if they were components.
            // For this engine, we treat them as components too.

            const deductions = components.filter(c => (c.type === 'deduction' || c.type === 'tax') && c.active);
            let totalDeductions = 0;

            for (const comp of deductions) {
                let amount = 0;
                // Update context for deduction formulas that might depend on gross
                context.gross_pay_current = context.gross_pay;

                if (comp.calculation_type === 'fixed') {
                    amount = parseFloat(comp.formula || 0);
                } else if (comp.calculation_type === 'percentage') {
                    const pct = parseFloat(comp.formula || 0);
                    amount = context.gross_pay * (pct / 100);
                } else if (comp.calculation_type === 'formula') {
                    amount = evaluateFormula(comp.formula, context);
                }

                if (amount > 0) {
                    totalDeductions += amount;
                    payslipItems.push({ name: comp.name, type: comp.type, amount });
                }
            }

            const netPay = context.gross_pay - totalDeductions;

            results.push({
                user_id: userId,
                name: empData.full_name,
                basic_salary: basic,
                gross_pay: context.gross_pay,
                total_deductions: totalDeductions,
                net_pay: netPay,
                items: payslipItems
            });
        }

        return results;
    },

    /**
     * Run Payroll (Save to DB)
     */
    runPayroll: (periodStart, periodEnd, employeeIds, userId) => {
        const simulation = PayrollService.simulatePayroll(employeeIds);

        let totalGross = 0;
        let totalNet = 0;

        simulation.forEach(s => {
            totalGross += s.gross_pay;
            totalNet += s.net_pay;
        });

        // Create Run
        const runStmt = db.prepare(`
            INSERT INTO payroll_runs (company_id, period_start, period_end, status, total_gross, total_net, approved_by)
            VALUES (1, ?, ?, 'approved', ?, ?, ?)
        `);
        const info = runStmt.run(periodStart, periodEnd, totalGross, totalNet, userId);
        const runId = info.lastInsertRowid;

        // Create Payslips
        const payslipStmt = db.prepare(`
            INSERT INTO payslips (payroll_run_id, user_id, basic_salary, gross_pay, total_deductions, net_pay)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        const itemStmt = db.prepare(`
            INSERT INTO payslip_items (payslip_id, component_name, component_type, amount)
            VALUES (?, ?, ?, ?)
        `);

        for (const slip of simulation) {
            const slipInfo = payslipStmt.run(runId, slip.user_id, slip.basic_salary, slip.gross_pay, slip.total_deductions, slip.net_pay);
            const payslipId = slipInfo.lastInsertRowid;

            for (const item of slip.items) {
                itemStmt.run(payslipId, item.name, item.type, item.amount);
            }
        }

        return { success: true, runId };
    },

    /**
     * Get Runs History
     */
    getRuns: () => {
        return db.prepare('SELECT * FROM payroll_runs ORDER BY run_date DESC').all();
    }
};

export default PayrollService;
