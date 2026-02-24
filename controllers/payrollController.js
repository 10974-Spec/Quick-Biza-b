import PayrollService from '../services/payrollService.js';
import db from '../database/db.js';

const PayrollController = {
    getSettings: (req, res) => {
        try {
            const settings = PayrollService.getSettings(req.user?.company_id || 1);
            res.json(settings);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    updateSettings: (req, res) => {
        try {
            const settings = PayrollService.updateSettings(req.user?.company_id || 1, req.body);
            res.json(settings);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    getComponents: (req, res) => {
        try {
            const components = PayrollService.getComponents(req.user?.company_id || 1);
            res.json(components);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    saveComponent: (req, res) => {
        try {
            const component = PayrollService.saveComponent({
                ...req.body,
                company_id: req.user?.company_id || 1
            });
            res.json(component);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    deleteComponent: (req, res) => {
        try {
            const { id } = req.params;
            db.prepare('DELETE FROM payroll_components WHERE id = ?').run(id);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    getEmployeeData: (req, res) => {
        try {
            const { id } = req.params;
            const data = PayrollService.getEmployeeData(id);
            res.json(data);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    updateEmployeeData: (req, res) => {
        try {
            const { id } = req.params;
            const data = PayrollService.updateEmployeeData(id, req.body);
            res.json(data);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    getAllEmployees: (req, res) => {
        try {
            const employees = PayrollService.getAllEmployeesData();
            res.json(employees);
        } catch (error) {
            console.error('\n[Payroll API Error] Failed to fetch employees:\n', error.message, error.stack, '\n');
            res.status(500).json({ error: error.message });
        }
    },

    simulateRun: (req, res) => {
        try {
            const { employeeIds } = req.body;
            // If no employees specified, get all active users
            let targetIds = employeeIds;
            if (!targetIds || targetIds.length === 0) {
                const users = db.prepare("SELECT id FROM users WHERE status = 'approved'").all();
                targetIds = users.map(u => u.id);
            }

            const results = PayrollService.simulatePayroll(targetIds);
            res.json(results);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    executeRun: (req, res) => {
        try {
            const { periodStart, periodEnd, employeeIds } = req.body;
            let targetIds = employeeIds;
            if (!targetIds || targetIds.length === 0) {
                const users = db.prepare("SELECT id FROM users WHERE status = 'approved'").all();
                targetIds = users.map(u => u.id);
            }

            const result = PayrollService.runPayroll(periodStart, periodEnd, targetIds, req.user?.id || 1);
            res.json(result);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: error.message });
        }
    },

    getRuns: (req, res) => {
        try {
            const runs = PayrollService.getRuns();
            res.json(runs);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
};

export default PayrollController;
