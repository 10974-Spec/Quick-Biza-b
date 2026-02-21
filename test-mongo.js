
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

console.log("Testing Connection to:", MONGO_URI);

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log("✅ MongoDB Connection Successful!");
        process.exit(0);
    })
    .catch((err) => {
        console.error("❌ MongoDB Connection Failed:", err.message);
        process.exit(1);
    });
