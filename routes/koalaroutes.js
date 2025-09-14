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
    const keys = Object.keys(obj).sort();
    for (const key of keys) {
      const value = obj[key];
      if (Array.isArray(value)) value.forEach(item => processObject(item));
      else if (typeof value === "object" && value !== null) processObject(value);
      else values.push(value.toString());
    }
  };
  processObject(params);
  return crypto.createHash("md5").update(`${token}:${values.join(":")}`).digest("hex");
}

// Safe JSON parser
async function safeJsonParse(response) {
  const text = await response.text();
  if (text.includes("Unauthorized")) throw new Error("API authentication failed");
  try { return JSON.parse(text); }
  catch (e) { throw new Error(`Invalid API response: ${text.substring(0, 150)}...`); }
}

// Start flight search
router.post("/flights", authMiddleware, async (req, res) => {
  try {
    if (!TOKEN || !MARKER) return res.status(500).json({ error: "API key or marker missing" });

    const { origin, destination, departure_at, return_at, passengers = 1, trip_class = "Y" } = req.body;
    if (!origin || !destination || !departure_at) return res.status(400).json({ error: "Origin, destination, and departure date are required" });

    const segments = [{ origin: origin.toUpperCase(), destination: destination.toUpperCase(), date: departure_at }];
    if (return_at) segments.push({ origin: destination.toUpperCase(), destination: origin.toUpperCase(), date: return_at });

    const signatureParams = {
      marker: MARKER,
      host: req.headers.host || "localhost",
      user_ip: req.ip || req.socket.remoteAddress || "127.0.0.1",
      locale: "en",
      trip_class: trip_class.toUpperCase(),
      passengers: { adults: parseInt(passengers) || 1, children: 0, infants: 0 },
      segments,
    };

    const payload = { ...signatureParams, signature: generateSignature(signatureParams, TOKEN) };

    const searchResponse = await fetch(SEARCH_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Access-Token": TOKEN },
      body: JSON.stringify(payload),
    });

    const searchData = await safeJsonParse(searchResponse);
    if (!searchData.search_id) throw new Error("API did not return a search_id");

    res.json({ search_id: searchData.search_id });

  } catch (err) {
    console.error("Flight Init Error:", err.message);
    res.status(err.message.includes("authentication") ? 401 : 500).json({ error: err.message });
  }
});

// Poll flight results
router.get("/flights/:searchId", authMiddleware, async (req, res) => {
  try {
    const { searchId } = req.params;
    const { currency = "USD", passengers = 1 } = req.query;

    const maxAttempts = 36; // 3 minutes at 5s intervals
    let attempts = 0;
    let proposals = [];

    while (attempts < maxAttempts) {
      const resultsResponse = await fetch(`${RESULTS_API}?uuid=${searchId}`, {
        headers: { "X-Access-Token": TOKEN, "Accept-Encoding": "gzip, deflate" },
      });

      const resultsData = await safeJsonParse(resultsResponse);

      if (Array.isArray(resultsData)) proposals = resultsData;
      else if (Array.isArray(resultsData.data)) proposals = resultsData.data;
      else proposals = resultsData.proposals || [];

      if (proposals.length > 0) break;

      // Wait 5s before next poll
      await new Promise(r => setTimeout(r, 5000));
      attempts++;
    }

    if (proposals.length === 0) return res.json({ status: "pending", message: "No flights yet, try again shortly." });

    const conversionRates = { USD: 1, EUR: 0.9, GBP: 0.8 };
    const processedFlights = proposals.map(flight => ({
      airline: flight.airline || "Multiple Airlines",
      departure_at: flight.departure_at || flight.departure_time || "N/A",
      arrival_at: flight.arrival_at || flight.arrival_time || "N/A",
      origin: flight.origin || "N/A",
      destination: flight.destination || "N/A",
      price: flight.price ? (flight.price * (conversionRates[currency.toUpperCase()] || 1) * parseInt(passengers)).toFixed(2) : "N/A",
      currency: currency.toUpperCase(),
      passengers: parseInt(passengers),
    }));

    res.json({ status: "complete", data: processedFlights });

  } catch (err) {
    console.error("Flight Poll Error:", err.message);
    res.status(err.message.includes("authentication") ? 401 : 500).json({ error: err.message });
  }
});

router.get("/health", (req, res) => res.json({ status: "ok" }));
router.get("/debug", (req, res) => res.json({ tokenPresent: !!TOKEN, markerPresent: !!MARKER }));

export default router;
