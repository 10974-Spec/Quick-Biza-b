import { importService } from '../services/importService.js';
import fs from 'fs';

export const importController = {
    // GET /api/import/template/:type
    downloadTemplate: (req, res) => {
        try {
            const { type } = req.params;
            const buffer = importService.generateTemplate(type);

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=${type}_template.xlsx`);
            res.send(buffer);
        } catch (error) {
            console.error('Template generation failed:', error);
            res.status(400).json({ error: error.message });
        }
    },

    // POST /api/import/:type
    importData: async (req, res) => {
        try {
            const { type } = req.params;
            const file = req.file;

            if (!file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }

            // Parse File
            const data = importService.parseExcel(file.path);

            // Process Data
            const result = await importService.importData(type, data);

            // Cleanup Uploaded File
            fs.unlinkSync(file.path);

            res.json(result);
        } catch (error) {
            console.error('Import failed:', error);
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            res.status(500).json({ error: error.message });
        }
    }
};
