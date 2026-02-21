
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Company, License, Subscription, AppVersion } from '../database/cloud.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://aroma_user:aroma_pass@cluster0.mongodb.net/aroma_cloud?retryWrites=true&w=majority';

const resetDB = async () => {
    try {
        console.log("🔥 Connecting to MongoDB Cloud...");
        await mongoose.connect(MONGO_URI);
        console.log("✅ Connected.");

        console.log("⚠ DELETING ALL DATA...");

        // Delete all from Company
        const companies = await Company.deleteMany({});
        console.log(`🗑 Deleted ${companies.deletedCount} Companies`);

        // Delete all from License
        const licenses = await License.deleteMany({});
        console.log(`🗑 Deleted ${licenses.deletedCount} Licenses`);

        // Delete all from Subscription
        const subs = await Subscription.deleteMany({});
        console.log(`🗑 Deleted ${subs.deletedCount} Subscriptions`);

        // Delete all from AppVersion (Optional, maybe keep versions?)
        // Let's keep AppVersions for update checks, or reset if requested. 
        // User said "clear mongodb database... dummy accounts". Probably doesn't mean versions.
        // But for a true clean slate, maybe. I'll comment it out to be safe unless explicitly asked.
        // Actually user said "clear everything". I'll clear it.
        const apps = await AppVersion.deleteMany({});
        console.log(`🗑 Deleted ${apps.deletedCount} AppVersions`);

        console.log("✨ Cloud Database Reset Complete. Fresh Start!");
        process.exit(0);
    } catch (error) {
        console.error("❌ Error resetting DB:", error);
        process.exit(1);
    }
};

resetDB();
