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
// FIXED: This function now generates the signature correctly.
// The API requires parameters in a specific, non-alphabetical order.
//
function generateSignature(params, token) {
  const flattenValues = [];

  // **IMPORTANT**: The order of these values MUST match the API's requirements.
  flattenValues.push(params.marker);
  flattenValues.push(params.host);
  flattenValues.push(params.user_ip);
  flattenValues.push(params.locale);
  flattenValues.push(params.trip_class);

  // Add passenger counts in order: adults, children, infants
  flattenValues.push(params.passengers.adults);
  flattenValues.push(params.passengers.children);
  flattenValues.push(params.passengers.infants);

  // Add segment data in order: origin, destination, date for each segment
  params.segments.forEach((seg) => {
    flattenValues.push(seg.origin);
    flattenValues.push(seg.destination);
    flattenValues.push(seg.date);
  });

  const stringToHash = `${token}:${flattenValues.join(":")}`;

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

// Flight search endpoint 
router.post("/flights", authMiddleware, async (req, res) => {
  try {
    if (!TOKEN || !MARKER) {
      console.error("API key or marker is missing from .env file");
      return res.status(500).json({
        error: "Server configuration error: API key or marker missing",
      });
    }

    const {
      origin,
      destination,
      departure_at,
      return_at,
      currency = "usd",
      passengers = 1,
      trip_class = "Y",
    } = req.body;

    if (!origin || !destination || !departure_at) {
      return res.status(400).json({
        error: "Origin, destination, and departure date are required",
      });
    }

    // Prepare flight segments
    const segments = [
      {
        origin: origin.toUpperCase(),
        destination: destination.toUpperCase(),
        date: departure_at,
      },
    ];
    if (return_at) {
      segments.push({
        origin: destination.toUpperCase(),
        destination: origin.toUpperCase(),
        date: return_at,
      });
    }

    const requestParams = {
      marker: MARKER,
      host: req.headers.host || "localhost",
      user_ip: req.ip || req.socket.remoteAddress || "127.0.0.1",
      locale: "en",
      trip_class: trip_class.toUpperCase(),
      passengers: {
        adults: parseInt(passengers) || 1, // Ensure it's at least 1
        children: 0,
        infants: 0,
      },
      segments: segments,
    };

    // Generate the essential signature
    requestParams.signature = generateSignature(requestParams, TOKEN);

    // STEP 1: Initialize the search
    const searchResponse = await fetch(SEARCH_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Access-Token": TOKEN },
      body: JSON.stringify(requestParams),
    });

    if (searchResponse.status === 401) {
      throw new Error("API authentication failed. Check your API Key and Marker.");
    }

    const searchData = await safeJsonParse(searchResponse);
    const searchId = searchData.search_id;

    if (!searchId) {
      console.error("API did not return a search_id:", searchData);
      return res.status(500).json({ error: "Failed to initialize flight search" });
    }

    // STEP 2: Poll for the results
    let attempts = 0;
    const maxAttempts = 12; // 5s interval × 12 = 60s timeout
    let results = null;

    while (attempts < maxAttempts) {
      attempts++;
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds

      const resultsResponse = await fetch(`${RESULTS_API}?uuid=${searchId}`, {
        headers: {
          "Accept-Encoding": "gzip, deflate",
          "X-Access-Token": TOKEN,
        },
      });

      const resultsData = await safeJsonParse(resultsResponse);
      
      // Check if the response contains actual flight data
      // The API sends back `search_id` while it's still working.
      // A successful result is an array of flight objects.
      if (
        resultsResponse.ok &&
        Array.isArray(resultsData) &&
        resultsData.length > 0 &&
        !resultsData[0].search_id
      ) {
        results = resultsData;
        break; // Exit the loop once we have results
      }
    }

    if (!results) {
      return res
        .status(408)
        .json({ error: "Flight search timed out. No results found." });
    }

    // STEP 3: Process and send the results
    // NOTE: For a real app, use a currency API. These rates are examples.
    const conversionRates = { usd: 0.011, eur: 0.01, gbp: 0.009 };
    const processedResults = results.map((flight) => {
      const rate = conversionRates[currency.toLowerCase()] || 1;
      return {
        ...flight,
        price: (flight.price * rate * parseInt(passengers)).toFixed(2),
        currency: currency.toUpperCase(),
        passengers: parseInt(passengers),
      };
    });

    res.json({ search_id: searchId, data: processedResults });
  } catch (err) {
    // CLEANED: Simplified and more effective error handling
    console.error("Flight API Error:", err.message);
    res
      .status(err.message.includes("authentication") ? 401 : 500)
      .json({ error: err.message });
  }
});

// Endpoint to poll flight results manually if needed
router.get("/flights/:searchId", authMiddleware, async (req, res) => {
  try {
    const { searchId } = req.params;

    const resultsResponse = await fetch(`${RESULTS_API}?uuid=${searchId}`, {
      headers: { "Accept-Encoding": "gzip, deflate", "X-Access-Token": TOKEN },
    });

    if (resultsResponse.status === 401) {
      throw new Error("API authentication failed.");
    }

    const resultsData = await safeJsonParse(resultsResponse);

    if (!resultsResponse.ok) {
      return res.status(resultsResponse.status).json({
        error: "Failed to fetch flight results",
        details: resultsData.error || "Unknown error",
      });
    }

    res.json({ data: resultsData });
  } catch (err) {
    console.error("Flight Results API Error:", err.message);
    res
      .status(err.message.includes("authentication") ? 401 : 500)
      .json({ error: err.message });
  }
});

// Health check and debug endpoints remain the same...

router.get("/health", async (req, res) => {
 try {
   if (!TOKEN || !MARKER) {
     return res
       .status(500)
       .json({ status: "error", message: "API credentials not configured" });
   }
   const testResponse = await fetch(
     "https://api.travelpayouts.com/v1/latest_currencies",
     {
       headers: { "X-Access-Token": TOKEN },
     }
   );
   if (testResponse.status === 200) {
     res.json({ status: "success", message: "API connectivity verified" });
   } else if (testResponse.status === 401) {
     res
       .status(401)
       .json({ status: "error", message: "API authentication failed" });
   } else {
     const text = await testResponse.text();
     res
       .status(testResponse.status)
       .json({
         status: "error",
         message: `API returned status ${testResponse.status}`,
         response: text.substring(0, 200),
       });
   }
 } catch (err) {
   res
     .status(500)
     .json({
       status: "error",
       message: "Failed to connect to API: " + err.message,
     });
 }
});

router.get("/debug", (req, res) => {
 res.json({
   tokenPresent: !!TOKEN,
   markerPresent: !!MARKER,
   tokenPrefix: TOKEN ? TOKEN.substring(0, 10) + "..." : "undefined",
   marker: MARKER,
 });
});

export default router;