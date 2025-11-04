import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";

// --- Route Imports ---
import authRoutes from "./routes/auth.js";
import contactRoutes from "./routes/contact.js";
import chatRouter from "./app/api/chat/route.js";"1"
// 1. FIX: Renamed variable and path to be correct
import amadeusRoutes from "./routes/amadeus.js"; 
// import koalaRoute from "./routes/koalaroutes.js"; 

dotenv.config();
const app = express();

// ... (Your CORS options are all correct) ...
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

app.use(cors(corsOptions));
app.use(express.json());

// --- API Routes ---
app.use("/api/auth", authRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/chat", chatRouter);
// 2. FIX: Mounted Amadeus routes at "/api"
// Now "/api" (from here) + "/airport-search" (from amadeus.js)
// will match the frontend call to "/api/airport-search"
app.use("/api", amadeusRoutes); 
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
T });

// --- Server Startup ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server is live and listening on port ${PORT}`);
});