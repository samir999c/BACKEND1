import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";

// --- Route Imports ---
import authRoutes from "./routes/auth.js";
import contactRoutes from "./routes/contact.js";
import chatRouter from "./app/api/chat/route.js";
import duffelRoutes from "./routes/amadeus.js"; 
import koalaRoute from "./routes/koalaroutes.js"; // NEW: bring back koalaroute.js

dotenv.config();
const app = express();

const allowedOrigins = [
  "https://koalarouteai.com",
  "https://www.koalarouteai.com",
  "http://localhost:5173" // For local testing
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
app.use("/api/duffel", duffelRoutes); 
app.use("/koalaroute", koalaRoute); // ✅ Now /koalaroute/dashboard works again

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
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server is live and listening on port ${PORT}`);
});
