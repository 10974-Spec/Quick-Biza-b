import express from 'express';
import { productionService } from '../services/productionService.js';

const router = express.Router();

// ─── INGREDIENTS ────────────────────────────────────────────────────────────
router.get('/ingredients', (req, res) => {
    try {
        const data = productionService.getAllIngredients();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/ingredients', (req, res) => {
    try {
        const data = productionService.createIngredient(req.body);
        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── RECIPES ────────────────────────────────────────────────────────────────
router.get('/recipes/:productId', (req, res) => {
    try {
        const data = productionService.getRecipeForProduct(req.params.productId);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/recipes/:productId', (req, res) => {
    try {
        productionService.saveRecipe(req.params.productId, req.body.ingredients);
        res.json({ success: true, message: 'Recipe saved successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─── PRODUCTION ─────────────────────────────────────────────────────────────
router.post('/check-feasibility', (req, res) => {
    try {
        const { productId, quantity } = req.body;
        const data = productionService.checkFeasibility(productId, quantity);
        res.json(data);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post('/record', (req, res) => {
    try {
        const logId = productionService.recordProduction({
            ...req.body,
            user_id: req.user ? req.user.id : null
        });
        res.status(201).json({ success: true, logId });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.get('/logs', (req, res) => {
    try {
        const data = productionService.getProductionLogs();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
