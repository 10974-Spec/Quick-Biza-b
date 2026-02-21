import express from 'express';
import multer from 'multer';

const router = express.Router();
const upload = multer({ dest: 'uploads/feedback/' });

router.post('/', upload.single('screenshot'), async (req, res) => {
    try {
        const { feedbackType, message, user_id, username, company } = req.body;
        const screenshot = req.file;

        console.log("=== NEW FEEDBACK RECEIVED ===");
        console.log(`Type: ${feedbackType}`);
        console.log(`From: ${username} (User ID: ${user_id})`);
        console.log(`Company: ${company}`);
        console.log(`Message: ${message}`);
        if (screenshot) {
            console.log(`Screenshot saved to: ${screenshot.path}`);
        }
        console.log("=============================");

        // In a real production environment, you would use Nodemailer or SendGrid here:
        /*
        await transporter.sendMail({
            from: '"SokoFlow System" <system@sokoflow.com>',
            to: process.env.ADMIN_EMAIL || 'support@sokoflow.com',
            subject: `[${feedbackType.toUpperCase()}] New Feedback from ${company}`,
            text: message,
            attachments: screenshot ? [{ path: screenshot.path }] : []
        });
        */

        res.status(200).json({ success: true, message: 'Feedback logged successfully' });
    } catch (error) {
        console.error("Feedback submission error:", error);
        res.status(500).json({ error: 'Failed to process feedback submission' });
    }
});

export default router;
