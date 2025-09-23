import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";

// --- Route Imports ---
import authRoutes from "./routes/auth.js";
import contactRoutes from "./routes/contact.js";
import chatRouter from "./app/api/chat/route.js";
import duffelRoutes from "./routes/duffel.js"; // ADDED: New Duffel router

// REMOVED: Old Aviasales/Koalaroute routers
// import koalaRoute from "./routes/koalaroutes.js";
// import aviasalesRouter from "./routes/aviasales.js";

dotenv.config();
const app = express();

const allowedOrigins = [
  'https://koalarouteai.com',
  'https://www.koalarouteai.com',
  'http://localhost:5173' // Kept for local testing
];
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// --- API Routes ---
app.use("/api/auth", authRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/chat", chatRouter);
app.use("/api/duffel", duffelRoutes); // ADDED: New Duffel routes are active at /api/duffel

// REMOVED: Old flight search routes
// app.use("/api/koalaroute", koalaRoute);
// app.use("/api/aviasales", aviasalesRouter);

// --- MongoDB Connection ---
const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  console.error("❌ FATAL ERROR: MONGO_URI is not defined.");
  process.exit(1);
}

mongoose
  .connect(mongoUri)
  .then(() => console.log("✅ MongoDB connected."))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

// --- Server Startup ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server is live and listening on port ${PORT}`);
});