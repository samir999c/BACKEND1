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

// Correct signature generation using alphabetical sort
function generateSignature(params, token) {
  const values = [];
  const processObject = (obj) => {
    const sortedKeys = Object.keys(obj).sort();
    for (const key of sortedKeys) {
      const value = obj[key];
      if (Array.isArray(value)) {
        value.forEach(item => processObject(item));
      } else if (typeof value === 'object' && value !== null) {
        processObject(value);
      } else {
        values.push(value.toString());
      }
    }
  };
  processObject(params);
  const valuesString = values.join(":");
  const stringToHash = `${token}:${valuesString}`;
  return crypto.createHash("md5").update(stringToHash).digest("hex");
}

// JSON parsing helper
async function safeJsonParse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid API response: ${text.substring(0, 150)}...`);
  }
}

// --- Endpoint 1: Starts the search and returns a search_id immediately ---
router.post("/flights", authMiddleware, async (req, res) => {
  try {
    if (!TOKEN || !MARKER) {
      return res.status(500).json({ error: "Server configuration error: Missing API credentials" });
    }

    const { origin, destination, departure_at, return_at, passengers = 1, trip_class = "Y" } = req.body;

    if (!origin || !destination || !departure_at) {
      return res.status(400).json({ error: "Missing required search parameters" });
    }

    const segments = [{ origin: origin.toUpperCase(), destination: destination.toUpperCase(), date: departure_at }];
    if (return_at) {
      segments.push({ origin: destination.toUpperCase(), destination: origin.toUpperCase(), date: return_at });
    }

    const paramsForSignature = {
      marker: MARKER,
      host: req.get('host'),
      user_ip: req.ip,
      locale: "en",
      trip_class: trip_class.toUpperCase(),
      passengers: { adults: parseInt(passengers) || 1, children: 0, infants: 0 },
      segments: segments,
    };

    const requestPayload = {
      ...paramsForSignature,
      signature: generateSignature(paramsForSignature, TOKEN),
    };

    const searchResponse = await fetch(SEARCH_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Access-Token": TOKEN },
      body: JSON.stringify(requestPayload),
    });

    const searchData = await safeJsonParse(searchResponse);
    if (searchResponse.status >= 400) {
      throw new Error(searchData.error || "Failed to initialize flight search.");
    }

    if (!searchData.search_id) {
      throw new Error("API did not return a search_id");
    }

    // Immediately return the search_id for the frontend to start polling
    res.json({ search_id: searchData.search_id });

  } catch (err) {
    console.error("Flight Init Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Endpoint 2: Used by the frontend to poll for results ---
router.get("/flights/:searchId", authMiddleware, async (req, res) => {
  try {
    const { searchId } = req.params;
    const { currency = "usd", passengers = 1 } = req.query;

    const resultsResponse = await fetch(`${RESULTS_API}?uuid=${searchId}`, {
      headers: { "Accept-Encoding": "gzip, deflate", "X-Access-Token": TOKEN },
    });

    const resultsData = await safeJsonParse(resultsResponse);
    if (resultsResponse.status >= 400) {
      throw new Error(resultsData.error || "Failed to fetch flight results.");
    }
    
    // Check if the response is the final result (an object with a 'proposals' array)
    if (resultsData && Array.isArray(resultsData.proposals)) {
        const conversionRates = { usd: 0.011, eur: 0.01, gbp: 0.009 };
        const processedResults = resultsData.proposals.map((flight) => {
          const rate = conversionRates[currency.toLowerCase()] || 1;
          const firstSegment = flight.segment[0];
          return {
            price: (flight.unified_price * rate).toFixed(2),
            currency: currency.toUpperCase(),
            sign: flight.sign,
            // Add key details for the frontend to display
            origin: firstSegment.departure,
            destination: flight.segment[flight.segment.length - 1].arrival,
            departure_at: `${firstSegment.departure_date}T${firstSegment.departure_time}`,
            arrival_at: `${flight.segment[flight.segment.length - 1].arrival_date}T${flight.segment[flight.segment.length - 1].arrival_time}`,
            marketing_carrier: firstSegment.marketing_carrier
          };
        });
        res.json({ status: 'complete', data: processedResults });
    } else {
        // If there is no 'proposals' key, the search is still pending.
        res.json({ status: 'pending' });
    }

  } catch (err) {
    console.error("Flight Poll Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;