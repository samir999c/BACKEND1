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

// Flight search endpoint
router.post("/flights", authMiddleware, async (req, res) => {
  try {
    if (!TOKEN || !MARKER) {
      console.error("API key or marker is missing from .env file");
      return res.status(500).json({
        error: "Server configuration error: API key or marker missing",
      });
    }

    // Note: The 'currency' parameter is received but NOT sent to Travelpayouts
    const {
      origin,
      destination,
      departure_at,
      return_at,
      currency = "usd", // Used for post-processing only
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
    
    // ## CRITICAL FIX ##
    // This is the object that will be used to generate the signature.
    // It MUST NOT contain any extra parameters like 'currency'.
    const paramsForSignature = {
      marker: MARKER,
      host: req.headers.host || "localhost",
      user_ip: req.ip || req.socket.remoteAddress || "127.0.0.1",
      locale: "en",
      trip_class: trip_class.toUpperCase(),
      passengers: {
        adults: parseInt(passengers) || 1,
        children: 0,
        infants: 0,
      },
      segments: segments,
    };
    
    // This is the actual payload we send to the API. It includes the signature.
    const requestPayload = {
        ...paramsForSignature,
        signature: generateSignature(paramsForSignature, TOKEN),
    }

    // STEP 1: Initialize the search
    const searchResponse = await fetch(SEARCH_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Access-Token": TOKEN },
      body: JSON.stringify(requestPayload),
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

      if (
        resultsResponse.ok &&
        Array.isArray(resultsData) &&
        resultsData.length > 0 &&
        !resultsData[0].search_id // This confirms we have actual flight data
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
    const conversionRates = { usd: 0.011, eur: 0.01, gbp: 0.009 }; // Example rates
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

// Health check and debug endpoints
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