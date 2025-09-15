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
const HOST = process.env.AVIASALES_HOST || "www.koalarouteai.com";

// --- Generate signature as per Travelpayouts docs ---
function generateSignature(params, token) {
  const values = [];
  const collectValues = (obj) => {
    const sortedKeys = Object.keys(obj).sort();
    for (const key of sortedKeys) {
      const value = obj[key];
      if (Array.isArray(value)) value.forEach((item) => collectValues(item));
      else if (typeof value === "object" && value !== null) collectValues(value);
      else values.push(value.toString());
    }
  };
  collectValues(params);
  const valuesString = values.join(":");
  return crypto.createHash("md5").update(`${token}:${valuesString}`).digest("hex");
}

// --- Safe JSON parse with error logging ---
async function safeJsonParse(response) {
  const text = await response.text();
  if (text.includes("Unauthorized")) {
    throw new Error("API authentication failed: Unauthorized");
  }
  try {
    return JSON.parse(text);
  } catch {
    console.error("Failed to parse JSON. Raw response:", text);
    throw new Error("Invalid API response from Travelpayouts");
  }
}

// Root endpoint
router.get("/", (req, res) => res.json({ msg: "Welcome to KoalaRoute API!" }));

// Dashboard endpoint (protected)
router.get("/dashboard", authMiddleware, (req, res) =>
  res.json({ msg: "Welcome back!", userId: req.user.id })
);

// --- Start a flight search ---
router.post("/flights", authMiddleware, async (req, res) => {
  try {
    if (!TOKEN || !MARKER) {
      return res.status(500).json({ error: "API key or marker missing" });
    }

    const { origin, destination, departure_at, return_at, passengers = 1, trip_class = "Y" } = req.body;

    if (!origin || !destination || !departure_at) {
      return res.status(400).json({ error: "Origin, destination, and departure date are required" });
    }

    const segments = [
      { origin: origin.toUpperCase(), destination: destination.toUpperCase(), date: departure_at },
    ];
    if (return_at) {
      segments.push({
        origin: destination.toUpperCase(),
        destination: origin.toUpperCase(),
        date: return_at,
      });
    }

    const params = {
      marker: MARKER,
      host: HOST,
      user_ip: req.ip || req.socket.remoteAddress || "127.0.0.1",
      locale: "en",
      trip_class: trip_class.toUpperCase(),
      passengers: { adults: parseInt(passengers) || 1, children: 0, infants: 0 },
      segments,
    };

    const signature = generateSignature(params, TOKEN);
    const payload = { ...params, signature };

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

// --- Poll flight results ---
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

      resultsData = await safeJsonParse(resultsResponse);

      const proposals = resultsData.proposals || [];

      if (proposals.length > 0) {
        // Map proposals into simpler format for frontend
        const processedResults = proposals.map((flight) => ({
          airline: flight.airline || "N/A",
          origin: flight.origin || flight.segments?.[0]?.origin || "N/A",
          destination: flight.destination || flight.segments?.slice(-1)[0]?.destination || "N/A",
          departure_at: flight.departure_at || flight.segments?.[0]?.date || "N/A",
          return_at: flight.return_at || flight.segments?.slice(-1)[0]?.date || "N/A",
          price: flight.unified_price
            ? (flight.unified_price * parseInt(passengers)).toFixed(2)
            : "N/A",
          currency: currency.toUpperCase(),
        }));

        return res.json({ status: "complete", proposals: processedResults });
      }

      attempts++;
      await new Promise((r) => setTimeout(r, 3000)); // wait 3 sec
    }

    res.json({ status: "pending", message: "Results not ready yet, try again shortly." });
  } catch (err) {
    console.error("Flight Poll Error:", err.message);
    res.status(err.message.includes("authentication") ? 401 : 500).json({ error: err.message });
  }
});

// Health check
router.get("/health", (req, res) => res.json({ status: "ok" }));

// Debug
router.get("/debug", (req, res) =>
  res.json({ tokenPresent: !!TOKEN, markerPresent: !!MARKER, host: HOST })
);

export default router;
