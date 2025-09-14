import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import { authMiddleware } from "../middleware/auth.js";
import "dotenv/config";

const router = express.Router();

const SEARCH_API = "https://api.travelpayouts.com/v1/flight_search";
const RESULTS_API = "https://api.travelpayouts.com/v1/flight_search_results";
const TOKEN = process.env.AVIASALES_API_KEY;
const MARKER = process.env.AVIASALES_MARKER;

// Generate signature for Travelpayouts
function generateSignature(params, token) {
  const values = [];
  const processObject = (obj) => {
    const sortedKeys = Object.keys(obj).sort();
    for (const key of sortedKeys) {
      const value = obj[key];
      if (Array.isArray(value)) value.forEach(item => processObject(item));
      else if (typeof value === "object" && value !== null) processObject(value);
      else values.push(value.toString());
    }
  };
  processObject(params);
  const valuesString = values.join(":");
  const stringToHash = `${token}:${valuesString}`;
  return crypto.createHash("md5").update(stringToHash).digest("hex");
}

// Safely parse API responses
async function safeJsonParse(response) {
  const text = await response.text();
  if (text.includes("Unauthorized")) throw new Error("API authentication failed: Unauthorized");
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse JSON. Raw Response:", text);
    throw new Error(`Invalid API response: ${text.substring(0, 150)}...`);
  }
}

// Root endpoint
router.get("/", (req, res) => res.json({ msg: "Welcome to KoalaRoute API!" }));

// Dashboard endpoint (protected)
router.get("/dashboard", authMiddleware, (req, res) => res.json({ msg: "Welcome back!", userId: req.user.id }));

// Start a flight search
router.post("/flights", authMiddleware, async (req, res) => {
  try {
    if (!TOKEN || !MARKER) return res.status(500).json({ error: "API key or marker missing" });

    const { origin, destination, departure_at, return_at, passengers = 1, trip_class = "Y" } = req.body;
    if (!origin || !destination || !departure_at) {
      return res.status(400).json({ error: "Origin, destination, and departure date are required" });
    }

    const segments = [{ origin: origin.toUpperCase(), destination: destination.toUpperCase(), date: departure_at }];
    if (return_at) segments.push({ origin: destination.toUpperCase(), destination: origin.toUpperCase(), date: return_at });

    const paramsForSignature = {
      marker: MARKER,
      host: process.env.AVIASALES_HOST || req.headers.host || "localhost",
      user_ip: req.ip || req.socket.remoteAddress || "127.0.0.1",
      locale: "en",
      trip_class: trip_class.toUpperCase(),
      passengers: { adults: parseInt(passengers) || 1, children: 0, infants: 0 },
      segments,
    };

    const requestPayload = { ...paramsForSignature, signature: generateSignature(paramsForSignature, TOKEN) };

    const searchResponse = await fetch(SEARCH_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Access-Token": TOKEN },
      body: JSON.stringify(requestPayload),
    });

    if (searchResponse.status >= 400) {
      const errorData = await safeJsonParse(searchResponse);
      throw new Error(errorData.error || "Failed to initialize flight search.");
    }

    const searchData = await safeJsonParse(searchResponse);
    if (!searchData.search_id) throw new Error("API did not return a search_id");

    res.json({ search_id: searchData.search_id });
  } catch (err) {
    console.error("Flight Init Error:", err.message);
    res.status(err.message.includes("authentication") ? 401 : 500).json({ error: err.message });
  }
});

// Poll flight results using proposals and unified_price
router.get("/flights/:searchId", authMiddleware, async (req, res) => {
  try {
    const { searchId } = req.params;
    const { currency = "USD", passengers = 1 } = req.query;

    let attempts = 0;
    let resultsData = null;

    while (attempts < 10) {
      const resultsResponse = await fetch(`${RESULTS_API}?uuid=${searchId}`, {
        headers: { "Accept-Encoding": "gzip, deflate", "X-Access-Token": TOKEN },
      });

      if (resultsResponse.status >= 400) {
        const errorData = await safeJsonParse(resultsResponse);
        throw new Error(errorData.error || "Failed to fetch flight results.");
      }

      resultsData = await safeJsonParse(resultsResponse);
      console.log("Raw Travelpayouts Results:", JSON.stringify(resultsData, null, 2));

      // Check proposals array for actual flights
      const flightsArray = Array.isArray(resultsData.proposals) ? resultsData.proposals : [];

      if (!flightsArray.length) {
        attempts++;
        await new Promise(r => setTimeout(r, 3000)); // wait 3 seconds
        continue;
      }

      // Process flights safely
      const conversionRates = { USD: 1, EUR: 0.9, GBP: 0.8 };
      const processedResults = flightsArray.map(flight => ({
        airline: flight.airline || "N/A",
        departure_at: flight.departure_at || "N/A",
        return_at: flight.return_at || "N/A",
        origin: flight.origin || "N/A",
        destination: flight.destination || "N/A",
        price: flight.unified_price
          ? (flight.unified_price * (conversionRates[currency.toUpperCase()] || 1) * parseInt(passengers)).toFixed(2)
          : "N/A",
        currency: currency.toUpperCase(),
        passengers: parseInt(passengers),
      }));

      return res.json({ status: "complete", data: processedResults });
    }

    // If no flights after retries
    res.json({ status: "pending", message: "Results not ready yet, try again shortly." });

  } catch (err) {
    console.error("Flight Poll Error:", err.message);
    res.status(err.message.includes("authentication") ? 401 : 500).json({ error: err.message });
  }
});

// Health check and debug endpoints
router.get("/health", (req, res) => res.json({ status: "ok" }));
router.get("/debug", (req, res) => res.json({ tokenPresent: !!TOKEN, markerPresent: !!MARKER }));

export default router;
