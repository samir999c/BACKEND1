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

async function safeJsonParse(response) {
  const text = await response.text();
  if (text.includes("Unauthorized")) {
    throw new Error("API authentication failed: Unauthorized");
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid API response: ${text.substring(0, 150)}...`);
  }
}

// **FINAL, ROBUST FLIGHT SEARCH ENDPOINT**
router.post("/flights", authMiddleware, async (req, res) => {
  try {
    if (!TOKEN || !MARKER) {
      return res.status(500).json({ error: "Server configuration error" });
    }

    const { origin, destination, departure_at, return_at, currency = "usd", passengers = 1, trip_class = "Y" } = req.body;

    if (!origin || !destination || !departure_at) {
      return res.status(400).json({ error: "Missing required search parameters" });
    }

    const segments = [{ origin: origin.toUpperCase(), destination: destination.toUpperCase(), date: departure_at }];
    if (return_at) {
      segments.push({ origin: destination.toUpperCase(), destination: origin.toUpperCase(), date: return_at });
    }

    const paramsForSignature = {
      marker: MARKER,
      host: req.headers.host || "localhost",
      user_ip: req.ip || req.socket.remoteAddress || "127.0.0.1",
      locale: "en",
      trip_class: trip_class.toUpperCase(),
      passengers: { adults: parseInt(passengers) || 1, children: 0, infants: 0 },
      segments: segments,
    };

    const requestPayload = {
      ...paramsForSignature,
      signature: generateSignature(paramsForSignature, TOKEN),
    };

    // Step 1: Initialize the search
    const searchResponse = await fetch(SEARCH_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Access-Token": TOKEN },
      body: JSON.stringify(requestPayload),
    });

    if (searchResponse.status >= 400) {
      const errorData = await safeJsonParse(searchResponse);
      throw new Error(errorData.error || "Failed to initialize search.");
    }

    const searchData = await safeJsonParse(searchResponse);
    if (!searchData.search_id) {
      throw new Error("API did not return a search_id");
    }
    const searchId = searchData.search_id;

    // Step 2: Backend handles the polling
    let attempts = 0;
    const maxAttempts = 12;
    while (attempts < maxAttempts) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

      const resultsResponse = await fetch(`${RESULTS_API}?uuid=${searchId}`, {
        headers: { "Accept-Encoding": "gzip, deflate", "X-Access-Token": TOKEN },
      });

      const resultsData = await safeJsonParse(resultsResponse);
      
      // Check if the response is the final result (an array with content)
      if (Array.isArray(resultsData) && resultsData.length > 0 && !resultsData[0].search_id) {
        // Success! Process and return the results.
        const conversionRates = { usd: 0.011, eur: 0.01, gbp: 0.009 };
        const processedResults = resultsData.map((flight) => {
          const rate = conversionRates[currency.toLowerCase()] || 1;
          return { ...flight, price: (flight.price * rate * parseInt(passengers)).toFixed(2), currency: currency.toUpperCase() };
        });
        return res.json({ data: processedResults });
      }
      // If the API returns an empty array but we haven't timed out, we assume it's still pending.
    }
    
    // If the loop finishes without results, send a timeout response.
    return res.status(408).json({ error: "Flight search timed out on the server." });

  } catch (err) {
    console.error("Flight Search Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// Health check and other routes
router.get("/health", (req, res) => res.json({ status: "ok" }));
router.get("/debug", (req, res) => res.json({ tokenPresent: !!TOKEN, markerPresent: !!MARKER }));

export default router;