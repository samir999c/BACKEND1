// import express from "express";
// import axios from "axios";

// const router = express.Router();

// const API_URL = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates";
// const API_KEY = process.env.AVIASALES_API_KEY;
// const MARKER = process.env.AVIASALES_MARKER;

// // Helper to add days to a date
// function addDays(dateStr, days) {
//   const date = new Date(dateStr);
//   date.setDate(date.getDate() + days);
//   return date.toISOString().split("T")[0];
// }

// router.post("/search", async (req, res) => {
//   try {
//     const {
//       origin,
//       destination,
//       departure_at,
//       return_at,
//       currency = "usd",
//       days_range = 2,
//     } = req.body;

//     if (!origin || !destination || !departure_at) {
//       return res.status(400).json({
//         error: "Origin, destination, and departure date are required",
//       });
//     }

//     const allFlights = [];

//     // Call API for departure date and +/- days_range
//     for (let offset = -days_range; offset <= days_range; offset++) {
//       const depDate = addDays(departure_at, offset);

//       const response = await axios.get(API_URL, {
//         params: {
//           origin: origin.toUpperCase(),
//           destination: destination.toUpperCase(),
//           departure_at: depDate,
//           return_at,
//           currency,
//           unique: false,
//           sorting: "price",
//           limit: 10,
//           marker: MARKER,
//           token: API_KEY,
//         },
//       });

//       const flightsData = response.data?.data;
//       if (flightsData) {
//         allFlights.push(...flightsData);
//       }
//     }

//     if (allFlights.length === 0) {
//       return res
//         .status(404)
//         .json({ error: "No flights found for the given dates" });
//     }

//     res.json({ data: allFlights });
//   } catch (err) {
//     console.error("Aviasales API error:", err.response?.data || err.message);
//     res.status(500).json({
//       error: "Flight search failed",
//       details: err.response?.data || err.message,
//     });
//   }
// });
// // test comit

// export default router;

// import express from "express";
// import axios from "axios";
// import crypto from "crypto";

// const router = express.Router();

// const API_URL = "https://api.travelpayouts.com/v1/flight_search";
// const RESULTS_URL = "https://api.travelpayouts.com/v1/flight_search_results";

// const MARKER = process.env.AVIASALES_MARKER; // e.g., 662691
// const API_KEY = process.env.AVIASALES_API_KEY; // your API key (used as token and secret)
// const LOCALE = "en";

// // Generate MD5 signature dynamically using API_KEY as secret
// function generateSignature(marker, secret, host, userIp) {
//   const stringToHash = marker + secret + host + userIp;
//   return crypto.createHash("md5").update(stringToHash).digest("hex");
// }

// // Get user IP safely
// function getUserIp(req) {
//   return (
//     req.headers["x-forwarded-for"] || req.connection.remoteAddress || "0.0.0.0"
//   );
// }

// // POST /api/aviasales/search
// router.post("/search", async (req, res) => {
//   try {
//     const {
//       origin,
//       destination,
//       departure,
//       returnDate,
//       passengers = 1,
//       children = 0,
//       infants = 0,
//       tripClass = "Y",
//     } = req.body;

//     if (!origin || !destination || !departure) {
//       return res
//         .status(400)
//         .json({
//           error: "Origin, destination, and departure date are required",
//         });
//     }

//     // Passengers object
//     const passengersObj = { adults: passengers, children, infants };

//     // Build segments array
//     const segments = [
//       {
//         origin: origin.toUpperCase(),
//         destination: destination.toUpperCase(),
//         date: departure,
//       },
//     ];
//     if (returnDate) {
//       segments.push({
//         origin: destination.toUpperCase(),
//         destination: origin.toUpperCase(),
//         date: returnDate,
//       });
//     }

//     // Host & user IP
//     const host = req.headers.host || "localhost";
//     const userIp = getUserIp(req);

//     // Dynamic signature
//     const signature = generateSignature(MARKER, API_KEY, host, userIp);

//     // Build payload
//     const payload = {
//       signature,
//       marker: MARKER,
//       token: API_KEY,
//       host,
//       user_ip: userIp,
//       locale: LOCALE,
//       trip_class: tripClass,
//       passengers: passengersObj,
//       segments,
//     };

//     console.log("Aviasales search payload:", JSON.stringify(payload, null, 2));

//     // Step 1: Initialize search
//     const searchResponse = await axios.post(API_URL, payload, {
//       headers: { "Content-Type": "application/json" },
//     });

//     const searchId =
//       searchResponse.data?.search_id || searchResponse.data?.uuid;
//     if (!searchId) {
//       return res
//         .status(500)
//         .json({ error: "Failed to get search_id from Aviasales" });
//     }

//     console.log("Search initialized. search_id:", searchId);

//     // Step 2: Poll results
//     let attempts = 0;
//     const maxAttempts = 10;
//     let flights = [];

//     while (attempts < maxAttempts && flights.length === 0) {
//       attempts++;
//       try {
//         const resultsResponse = await axios.get(RESULTS_URL, {
//           params: { uuid: searchId },
//         });
//         flights = resultsResponse.data?.proposals || [];
//         if (flights.length === 0) {
//           console.log(`Polling attempt ${attempts}, no flights yet...`);
//           await new Promise((resolve) => setTimeout(resolve, 3000));
//         }
//       } catch (pollErr) {
//         console.log(`Polling attempt ${attempts} failed:`, pollErr.message);
//         await new Promise((resolve) => setTimeout(resolve, 3000));
//       }
//     }

//     if (flights.length === 0) {
//       return res
//         .status(404)
//         .json({ error: "No flights found after polling. Try again later." });
//     }

//     res.json({ data: flights });
//   } catch (err) {
//     console.error(
//       "Aviasales Search API error:",
//       err.response?.data || err.message
//     );
//     res.status(500).json({
//       error: "Flight search failed",
//       details: err.response?.data || err.message,
//     });
//   }
// });

// export default router;

import express from "express";
import axios from "axios";
import dotenv from "dotenv";

// Load environment variables from the .env file
dotenv.config();

const router = express.Router();
const TOKEN = process.env.AVIASALES_API_KEY;
const API_URL = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates";

// GET /api/aviasales/prices?origin=MAD&destination=BCN&departure_at=2025-09&return_at=2025-10&limit=10
router.get("/prices", async (req, res) => {
  try {
    // Check if the API key is set
    if (!TOKEN) {
      return res.status(500).json({
        error: "Server configuration error: API key is not set.",
      });
    }

    const {
      origin,
      destination,
      departure_at,
      return_at,
      currency = "usd",
      limit = 30,
    } = req.query;

    // Validate required input
    if (!origin || !destination || !departure_at) {
      return res.status(400).json({
        error:
          "Missing required query parameters: origin, destination, departure_at",
      });
    }

    // Prepare the parameters for the API call
    const params = {
      origin: origin.toUpperCase(),
      destination: destination.toUpperCase(),
      departure_at,
      token: TOKEN,
      currency,
      limit,
      unique: false,
      sorting: "price",
      direct: false,
    };

    if (return_at) {
      params.return_at = return_at;
    }

    const response = await axios.get(API_URL, {
      params,
    });

    if (!response.data.success) {
      return res.status(500).json({
        error: "API request failed",
        details: response.data.error || "Unknown error",
      });
    }

    // The API returned multiple results, so we can send the whole array
    res.json({ data: response.data.data });
  } catch (error) {
    console.error(
      "Aviasales API error:",
      error.response?.data || error.message
    );
    res.status(500).json({
      error: "Failed to fetch flight prices",
      details: error.response?.data || error.message,
    });
  }
});

export default router;
