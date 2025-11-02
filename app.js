import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";

// --- Route Imports ---
import authRoutes from "./routes/auth.js";
import contactRoutes from "./routes/contact.js";
import chatRouter from "./app/api/chat/route.js";
import amadeusRoutes from "./routes/amadeus.js"; // Renamed for clarity
// import koalaRoute from "./routes/koalaroutes.js"; 

dotenv.config();
const app = express();

// =====================================================
//  THIS IS THE FIX FOR THE VALIDATIONERROR
//  It tells Express to trust Render's proxy
// =====================================================
app.set('trust proxy', 1);


// --- CORS Configuration ---
const allowedOrigins = [
  "https://koalarouteai.com",
  "https://www.koalarouteai.com",
  "http://localhost:5173" 
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

// This handles the "pre-flight" OPTIONS request
app.options('*', cors(corsOptions));

app.use(cors(corsOptions));
app.use(express.json());

// --- API Routes ---
app.use("/api/auth", authRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/chat", chatRouter);
app.use("/api", amadeusRoutes); // All Amadeus routes are at /api
// app.use("/api/koalaroute", koalaRoute); 

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