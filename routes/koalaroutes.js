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

//
// ## CRITICAL FIX ##
// This function now generates the signature by sorting keys alphabetically,
// as required by the Travelpayouts documentation to resolve the authentication error.
//
function generateSignature(params, token) {
  const values = [];

  // This recursive function will process all keys in alphabetical order
  const processObject = (obj) => {
    // Sort keys alphabetically
    const sortedKeys = Object.keys(obj).sort();

    for (const key of sortedKeys) {
      const value = obj[key];
      if (Array.isArray(value)) {
        // If it's an array of objects (like segments), process each one
        value.forEach(item => processObject(item));
      } else if (typeof value === 'object' && value !== null) {
        // If it's a nested object (like passengers), recurse
        processObject(value);
      } else {
        // Otherwise, it's a simple value
        values.push(value.toString());
      }
    }
  };

  processObject(params);

  const valuesString = values.join(":");
  const stringToHash = `${token}:${valuesString}`;

  return crypto.createHash("md5").update(stringToHash).digest("hex");
}


// Helper to safely parse API JSON responses
async function safeJsonParse(response) {
  const text = await response.text();
  if (text.includes("Unauthorized")) {
    throw new Error("API authentication failed: Unauthorized");
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse JSON. Raw Response:", text);
    throw new Error(`Invalid API response: ${text.substring(0, 150)}...`);
  }
}

// Root endpoint
router.get("/", (req, res) => {
  res.json({ msg: "Welcome to KoalaRoute API!" });
});

// Dashboard endpoint (protected)
router.get("/dashboard", authMiddleware, (req, res) => {
  res.json({ msg: "Welcome back!", userId: req.user.id });
});

// **FIXED**: This endpoint now starts the search and returns the search_id immediately.
router.post("/flights", authMiddleware, async (req, res) => {
  try {
    if (!TOKEN || !MARKER) {
      return res.status(500).json({ error: "Server configuration error: API key or marker missing" });
    }

    const { origin, destination, departure_at, return_at, passengers = 1, trip_class = "Y" } = req.body;

    if (!origin || !destination || !departure_at) {
      return res.status(400).json({ error: "Origin, destination, and departure date are required" });
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
    if (!searchData.search_id) {
        throw new Error("API did not return a search_id");
    }

    // Immediately return the search_id
    res.json({ search_id: searchData.search_id });

  } catch (err) {
    console.error("Flight Init Error:", err.message);
    res.status(err.message.includes("authentication") ? 401 : 500).json({ error: err.message });
  }
});

// This endpoint is used by the frontend to poll for results.
router.get("/flights/:searchId", authMiddleware, async (req, res) => {
  try {
    const { searchId } = req.params;
    const { currency = "usd", passengers = 1 } = req.query; // Get currency and passengers for final processing

    const resultsResponse = await fetch(`${RESULTS_API}?uuid=${searchId}`, {
      headers: { "Accept-Encoding": "gzip, deflate", "X-Access-Token": TOKEN },
    });

    if (resultsResponse.status >= 400) {
        const errorData = await safeJsonParse(resultsResponse);
        throw new Error(errorData.error || "Failed to fetch flight results.");
    }
    
    const resultsData = await safeJsonParse(resultsResponse);
    
    // The final result is an array of flight objects. A pending result is an object with a search_id.
    if (Array.isArray(resultsData) && (resultsData.length === 0 || !resultsData[0].search_id)) {
        // Process results with currency conversion before sending
        const conversionRates = { usd: 0.011, eur: 0.01, gbp: 0.009 }; // Example rates
        const processedResults = resultsData.map((flight) => {
          const rate = conversionRates[currency.toLowerCase()] || 1;
          return {
            ...flight,
            price: (flight.price * rate * parseInt(passengers)).toFixed(2),
            currency: currency.toUpperCase(),
            passengers: parseInt(passengers),
          };
        });
        res.json({ status: 'complete', data: processedResults });
    } else {
        res.json({ status: 'pending' });
    }

  } catch (err) {
    console.error("Flight Poll Error:", err.message);
    res.status(err.message.includes("authentication") ? 401 : 500).json({ error: err.message });
  }
});

// Health check and debug endpoints
router.get("/health", (req, res) => res.json({ status: "ok" }));
router.get("/debug", (req, res) => res.json({ tokenPresent: !!TOKEN, markerPresent: !!MARKER }));

export default router;