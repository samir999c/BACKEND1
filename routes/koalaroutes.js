// import express from "express";
// import fetch from "node-fetch";
// import crypto from "crypto";
// import { authMiddleware } from "../middleware/auth.js";
// import "dotenv/config";

// const router = express.Router();

// const SEARCH_API = "https://api.travelpayouts.com/v1/flight_search";
// const RESULTS_API = "https://api.travelpayouts.com/v1/flight_search_results";
// const TOKEN = process.env.AVIASALES_API_KEY;
// const MARKER = process.env.AVIASALES_MARKER;

// // Helper function to generate signature
// function generateSignature(params, token) {
//   try {
//     // Create a sorted array of all parameter values
//     const flattenObject = (obj) => {
//       const values = [];

//       const processValue = (value) => {
//         if (typeof value === "object" && value !== null) {
//           if (Array.isArray(value)) {
//             value.forEach((item) => processValue(item));
//           } else {
//             Object.values(value).forEach((val) => processValue(val));
//           }
//         } else {
//           values.push(value.toString());
//         }
//       };

//       Object.values(params).forEach((value) => processValue(value));
//       return values.sort();
//     };

//     const values = flattenObject(params);
//     const valuesString = values.join(":");
//     return crypto
//       .createHash("md5")
//       .update(`${token}:${valuesString}`)
//       .digest("hex");
//   } catch (err) {
//     console.error("Signature generation error:", err);
//     throw new Error("Failed to generate API signature");
//   }
// }

// // Helper function to safely parse JSON responses
// async function safeJsonParse(response) {
//   const text = await response.text();

//   // Check if response is unauthorized
//   if (text === "Unauthorized" || text.includes("Unauthorized")) {
//     throw new Error(
//       "API authentication failed: Unauthorized. Please check your API credentials."
//     );
//   }

//   try {
//     return JSON.parse(text);
//   } catch (e) {
//     console.error("Failed to parse JSON response. Raw response:", text);
//     throw new Error(
//       `API returned invalid response: ${text.substring(0, 100)}...`
//     );
//   }
// }

// // Dashboard routes
// router.get("/", (req, res) => {
//   try {
//     res.json({ msg: "Welcome !" });
//   } catch (err) {
//     console.error("Dashboard Error:", err);
//     res.status(500).json({ error: "Failed to fetch dashboard data" });
//   }
// });

// router.get("/dashboard", authMiddleware, (req, res) => {
//   try {
//     const userId = req.user.id;
//     res.json({ msg: "Welcome back!", userId });
//   } catch (err) {
//     console.error("Dashboard Error:", err);
//     res.status(500).json({ error: "Failed to fetch dashboard data" });
//   }
// });

// // Flight search endpoint
// router.post("/flights", authMiddleware, async (req, res) => {
//   try {
//     // Check if API credentials are configured
//     if (!TOKEN) {
//       console.error("AVIASALES_API_KEY is missing from environment variables");
//       return res.status(500).json({
//         error:
//           "Server configuration error: AVIASALES_API_KEY is missing from environment variables",
//       });
//     }

//     if (!MARKER) {
//       console.error("AVIASALES_MARKER is missing from environment variables");
//       return res.status(500).json({
//         error:
//           "Server configuration error: AVIASALES_MARKER is missing from environment variables",
//       });
//     }

//     console.log("API credentials found:", {
//       tokenPresent: !!TOKEN,
//       markerPresent: !!MARKER,
//       tokenPrefix: TOKEN ? TOKEN.substring(0, 10) + "..." : "undefined",
//       marker: MARKER,
//     });

//     const {
//       origin,
//       destination,
//       departure_at,
//       return_at,
//       currency = "usd",
//       passengers = 1,
//       trip_class = "Y",
//     } = req.body;

//     if (!origin || !destination || !departure_at) {
//       return res.status(400).json({
//         error: "Origin, destination, and departure date are required",
//       });
//     }

//     // Validate dates
//     const depDate = new Date(departure_at);
//     if (isNaN(depDate.getTime())) {
//       return res.status(400).json({ error: "Invalid departure date" });
//     }

//     // Prepare segments
//     const segments = [
//       {
//         origin: origin.toUpperCase(),
//         destination: destination.toUpperCase(),
//         date: departure_at,
//       },
//     ];

//     // Add return segment if provided
//     if (return_at) {
//       const retDate = new Date(return_at);
//       if (isNaN(retDate.getTime())) {
//         return res.status(400).json({ error: "Invalid return date" });
//       }
//       segments.push({
//         origin: destination.toUpperCase(),
//         destination: origin.toUpperCase(),
//         date: return_at,
//       });
//     }

//     // Prepare request parameters
//     const requestParams = {
//       marker: MARKER,
//       host: req.headers.host || "localhost",
//       user_ip: req.ip || req.connection.remoteAddress || "127.0.0.1",
//       locale: "en",
//       trip_class: trip_class.toUpperCase(),
//       passengers: {
//         adults: parseInt(passengers),
//         children: 0,
//         infants: 0,
//       },
//       segments: segments,
//     };

//     // Generate signature
//     requestParams.signature = generateSignature(requestParams, TOKEN);

//     console.log("Making API request with params:", {
//       ...requestParams,
//       signature: "***", // Don't log the actual signature
//     });

//     // Initialize search
//     const searchResponse = await fetch(SEARCH_API, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         "X-Access-Token": TOKEN,
//       },
//       body: JSON.stringify(requestParams),
//     });

//     // Log response details for debugging
//     console.log("API response status:", searchResponse.status);
//     console.log(
//       "API response headers:",
//       Object.fromEntries(searchResponse.headers.entries())
//     );

//     // Check response status before parsing
//     if (searchResponse.status === 401) {
//       return res.status(401).json({
//         error: "API authentication failed. Please check your API credentials.",
//       });
//     }

//     // Use safe JSON parsing
//     const searchData = await safeJsonParse(searchResponse);

//     if (!searchResponse.ok) {
//       return res.status(searchResponse.status).json({
//         error: searchData.error || "Failed to initialize flight search",
//       });
//     }

//     const searchId = searchData.search_id;

//     if (!searchId) {
//       return res.status(500).json({ error: "No search ID received from API" });
//     }

//     // Poll for results
//     let attempts = 0;
//     const maxAttempts = 12; // 60 seconds total with 5s intervals
//     let results = null;

//     while (attempts < maxAttempts && !results) {
//       attempts++;
//       await new Promise((resolve) => setTimeout(resolve, 5000));

//       try {
//         const resultsResponse = await fetch(`${RESULTS_API}?uuid=${searchId}`, {
//           headers: {
//             "Accept-Encoding": "gzip, deflate",
//             "X-Access-Token": TOKEN,
//           },
//         });

//         // Check response status before parsing
//         if (resultsResponse.status === 401) {
//           throw new Error("API authentication failed during results polling");
//         }

//         // Use safe JSON parsing
//         const resultsData = await safeJsonParse(resultsResponse);

//         if (resultsResponse.ok) {
//           // Check if we have actual results (not just search_id)
//           if (
//             Array.isArray(resultsData) &&
//             resultsData.length > 0 &&
//             !resultsData[0].search_id
//           ) {
//             results = resultsData;
//             break;
//           }
//         } else {
//           console.error("API error response:", resultsData);
//         }
//       } catch (pollError) {
//         console.error("Polling error:", pollError);
//         // Continue polling despite errors unless it's an auth error
//         if (pollError.message.includes("authentication failed")) {
//           break;
//         }
//       }
//     }

//     if (!results) {
//       return res.status(408).json({
//         error: "Flight search timeout. Please try again later.",
//       });
//     }

//     // Process results - convert currency and calculate total prices
//     const processedResults = results.map((flight) => {
//       // Note: API returns prices in RUB by default
//       let price = flight.price || 0;

//       // Simple currency conversion (in real app, use actual rates from API)
//       const conversionRates = {
//         usd: 0.011, // Example rate, use actual rates from API response
//         eur: 0.01,
//         gbp: 0.009,
//       };

//       const rate = conversionRates[currency.toLowerCase()] || 1;
//       const convertedPrice = price * rate * parseInt(passengers);

//       return {
//         ...flight,
//         price: convertedPrice.toFixed(2),
//         currency: currency.toUpperCase(),
//         passengers: parseInt(passengers),
//       };
//     });

//     res.json({
//       search_id: searchId,
//       data: processedResults,
//     });
//   } catch (err) {
//     console.error("Flight API Error:", err);

//     // Provide more specific error messages
//     if (err.message.includes("authentication failed")) {
//       res.status(401).json({
//         error: err.message,
//         details:
//           "Please check your AVIASALES_API_KEY and AVIASALES_MARKER environment variables",
//         troubleshooting: [
//           "Verify your API key and marker in the TravelPayouts dashboard",
//           "Check that your IP is whitelisted if required",
//           "Ensure your account has sufficient balance if the API requires prepayment",
//           "Confirm the API key has the correct permissions for flight search",
//         ],
//       });
//     } else {
//       res
//         .status(500)
//         .json({ error: "Failed to fetch flight data: " + err.message });
//     }
//   }
// });

// // Additional endpoint to check search status
// router.get("/flights/:searchId", authMiddleware, async (req, res) => {
//   try {
//     const { searchId } = req.params;

//     const resultsResponse = await fetch(`${RESULTS_API}?uuid=${searchId}`, {
//       headers: {
//         "Accept-Encoding": "gzip, deflate",
//         "X-Access-Token": TOKEN,
//       },
//     });

//     // Check response status before parsing
//     if (resultsResponse.status === 401) {
//       return res.status(401).json({
//         error: "API authentication failed. Please check your API credentials.",
//       });
//     }

//     // Use safe JSON parsing
//     const resultsData = await safeJsonParse(resultsResponse);

//     if (!resultsResponse.ok) {
//       return res.status(resultsResponse.status).json({
//         error:
//           "Failed to fetch flight results: " +
//           (resultsData.error || "Unknown error"),
//       });
//     }

//     res.json({ data: resultsData });
//   } catch (err) {
//     console.error("Flight Results API Error:", err);

//     if (err.message.includes("authentication failed")) {
//       res.status(401).json({
//         error: err.message,
//         details:
//           "Please check your AVIASALES_API_KEY and AVIASALES_MARKER environment variables",
//       });
//     } else {
//       res
//         .status(500)
//         .json({ error: "Failed to fetch flight results: " + err.message });
//     }
//   }
// });

// // Health check endpoint to verify API connectivity
// router.get("/health", async (req, res) => {
//   try {
//     if (!TOKEN || !MARKER) {
//       return res.status(500).json({
//         status: "error",
//         message: "API credentials not configured",
//       });
//     }

//     // Make a simple request to check API connectivity
//     const testResponse = await fetch(
//       "https://api.travelpayouts.com/v1/latest_currencies",
//       {
//         headers: {
//           "X-Access-Token": TOKEN,
//         },
//       }
//     );

//     // Log response details for debugging
//     console.log("Health check response status:", testResponse.status);

//     if (testResponse.status === 200) {
//       res.json({
//         status: "success",
//         message: "API connectivity verified",
//       });
//     } else if (testResponse.status === 401) {
//       res.status(401).json({
//         status: "error",
//         message: "API authentication failed",
//       });
//     } else {
//       const text = await testResponse.text();
//       res.status(testResponse.status).json({
//         status: "error",
//         message: `API returned status: ${testResponse.status}`,
//         response: text.substring(0, 200),
//       });
//     }
//   } catch (err) {
//     res.status(500).json({
//       status: "error",
//       message: "Failed to connect to API: " + err.message,
//     });
//   }
// });

// // Debug endpoint to check environment variables
// router.get("/debug", (req, res) => {
//   res.json({
//     tokenPresent: !!TOKEN,
//     markerPresent: !!MARKER,
//     tokenPrefix: TOKEN ? TOKEN.substring(0, 10) + "..." : "undefined",
//     marker: MARKER,
//   });
// });

// export default router;

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

// Correct signature generation function
function generateSignature(params, token) {
  const flattenValues = [];

  // Order matters: marker, host, user_ip, locale, trip_class, passengers, segments
  flattenValues.push(params.marker);
  flattenValues.push(params.host);
  flattenValues.push(params.user_ip);
  flattenValues.push(params.locale);
  flattenValues.push(params.trip_class);

  flattenValues.push(params.passengers.adults);
  flattenValues.push(params.passengers.children);
  flattenValues.push(params.passengers.infants);

  params.segments.forEach((seg) => {
    flattenValues.push(seg.origin);
    flattenValues.push(seg.destination);
    flattenValues.push(seg.date);
  });

  const stringToHash = `${token}:${flattenValues.join(":")}`;
  return crypto.createHash("md5").update(stringToHash).digest("hex");
}

// Helper to safely parse API JSON
async function safeJsonParse(response) {
  const text = await response.text();
  if (text.includes("Unauthorized")) {
    throw new Error("API authentication failed: Unauthorized");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid API response: ${text.substring(0, 100)}...`);
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

    // Prepare segments
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
      passengers: { adults: parseInt(passengers), children: 0, infants: 0 },
      segments: segments,
    };

    requestParams.signature = generateSignature(requestParams, TOKEN);

    const searchResponse = await fetch(SEARCH_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Access-Token": TOKEN },
      body: JSON.stringify(requestParams),
    });

    if (searchResponse.status === 401) {
      return res.status(401).json({ error: "API authentication failed" });
    }

    const searchData = await safeJsonParse(searchResponse);
    if (!searchData.search_id) {
      return res.status(500).json({ error: "No search ID returned from API" });
    }

    const searchId = searchData.search_id;

    // Polling for results
    let attempts = 0;
    const maxAttempts = 12; // 5s interval × 12 = 60s
    let results = null;

    while (attempts < maxAttempts && !results) {
      attempts++;
      await new Promise((r) => setTimeout(r, 5000));

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
        !resultsData[0].search_id
      ) {
        results = resultsData;
        break;
      }
    }

    if (!results) {
      return res
        .status(408)
        .json({ error: "Flight search timeout. Please try again later." });
    }

    // Currency conversion (example rates)
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
    console.error("Flight API Error:", err.message);
    res
      .status(err.message.includes("authentication") ? 401 : 500)
      .json({ error: err.message });
  }
});

// Poll flight results by search ID
router.get("/flights/:searchId", authMiddleware, async (req, res) => {
  try {
    const { searchId } = req.params;

    const resultsResponse = await fetch(`${RESULTS_API}?uuid=${searchId}`, {
      headers: { "Accept-Encoding": "gzip, deflate", "X-Access-Token": TOKEN },
    });

    if (resultsResponse.status === 401) {
      return res.status(401).json({ error: "API authentication failed" });
    }

    const resultsData = await safeJsonParse(resultsResponse);
    if (!resultsResponse.ok) {
      return res.status(resultsResponse.status).json({
        error:
          "Failed to fetch flight results: " +
          (resultsData.error || "Unknown error"),
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

// Health check endpoint
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

// Debug endpoint to check environment variables
router.get("/debug", (req, res) => {
  res.json({
    tokenPresent: !!TOKEN,
    markerPresent: !!MARKER,
    tokenPrefix: TOKEN ? TOKEN.substring(0, 10) + "..." : "undefined",
    marker: MARKER,
  });
});

export default router;
