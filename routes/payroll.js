import express from 'express';
import PayrollController from '../controllers/payrollController.js';
// import { authenticateToken } from '../middleware/auth.js'; // Ensure auth is used

const router = express.Router();

// Settings
router.get('/settings', PayrollController.getSettings);
router.post('/settings', PayrollController.updateSettings);

// Components
router.get('/components', PayrollController.getComponents);
router.post('/components', PayrollController.saveComponent);
router.delete('/components/:id', PayrollController.deleteComponent);

router.get('/employees', PayrollController.getAllEmployees);
router.get('/employees/:id', PayrollController.getEmployeeData);
router.put('/employees/:id', PayrollController.updateEmployeeData);

// Engine
router.post('/simulate', PayrollController.simulateRun);
router.post('/run', PayrollController.executeRun);
router.get('/runs', PayrollController.getRuns);

export default router;
