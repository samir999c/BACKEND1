import express from "express";
import axios from "axios";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

// Config
const TOKEN = process.env.AVIASALES_API_KEY;
const MARKER = process.env.AVIASALES_MARKER;
const HOST = process.env.AVIASALES_HOST; // must match your live domain in Travelpayouts
const V3_PRICES_API = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates";
const V1_SEARCH_API = "https://api.travelpayouts.com/v1/flight_search";
const V1_RESULTS_API = "https://api.travelpayouts.com/v1/flight_search_results";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function md5(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

function generateSignature(params, token) {
  const values = [];

  const process = (obj) => {
    if (obj === null || obj === undefined) return;
    if (typeof obj !== "object") {
      values.push(String(obj));
      return;
    }
    if (Array.isArray(obj)) {
      for (const item of obj) process(item);
      return;
    }
    const keys = Object.keys(obj).sort();
    for (const k of keys) process(obj[k]);
  };

  process(params);
  const joined = values.join(":");
  return md5(`${token}:${joined}`);
}

function appendMarkerToUrl(url, marker) {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.searchParams.set("marker", marker);
    return u.toString();
  } catch (e) {
    return url + (url.includes("?") ? "&" : "?") + `marker=${encodeURIComponent(marker)}`;
  }
}

function normalizePrice(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (raw > 1000) return (raw / 100).toFixed(2); // assume cents
    return raw.toFixed(2);
  }
  return String(raw);
}

/* -------------------------------------------------------------------------- */
/* prices_for_dates (fallback/calendar)                                       */
/* -------------------------------------------------------------------------- */

router.get("/prices", async (req, res) => {
  try {
    if (!TOKEN) {
      return res.status(500).json({ error: "API key missing" });
    }

    const { origin, destination, departure_at, return_at, currency = "usd", limit = 30 } = req.query;
    if (!origin || !destination || !departure_at) {
      return res.status(400).json({ error: "Missing required params: origin, destination, departure_at" });
    }

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
    if (return_at) params.return_at = return_at;

    const response = await axios.get(V3_PRICES_API, { params });

    return res.json({ data: response.data.data || [] });
  } catch (err) {
    console.error("Aviasales /prices error:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to fetch flight prices", details: err.response?.data || err.message });
  }
});

/* -------------------------------------------------------------------------- */
/* Initiate search (v1)                                                       */
/* -------------------------------------------------------------------------- */

router.post("/search", async (req, res) => {
  try {
    if (!TOKEN || !MARKER) {
      return res.status(500).json({ error: "Server config error: missing API key or marker" });
    }

    const {
      origin,
      destination,
      departure,
      returnDate,
      passengers = 1,
      children = 0,
      infants = 0,
      tripClass = "Y",
      currency = "USD",
    } = req.body;

    if (!origin || !destination || !departure) {
      return res.status(400).json({ error: "Origin, destination and departure are required." });
    }

    const segments = [{ origin: origin.toUpperCase(), destination: destination.toUpperCase(), date: departure }];
    if (returnDate) {
      segments.push({ origin: destination.toUpperCase(), destination: origin.toUpperCase(), date: returnDate });
    }

    const passengersObj = {
      adults: parseInt(passengers) || 1,
      children: parseInt(children) || 0,
      infants: parseInt(infants) || 0,
    };

    const hostToUse = HOST || req.headers.host || "localhost";

    const signatureParams = {
      marker: MARKER,
      host: hostToUse,
      user_ip: req.ip || req.socket?.remoteAddress || "127.0.0.1",
      locale: "en",
      trip_class: tripClass.toUpperCase(),
      passengers: passengersObj,
      segments,
    };

    const signature = generateSignature(signatureParams, TOKEN);

    // Travelpayouts expects x-www-form-urlencoded
    const payload = new URLSearchParams({ ...signatureParams, signature });

    const searchResponse = await axios.post(V1_SEARCH_API, payload.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const searchId = searchResponse.data?.search_id || searchResponse.data?.uuid;
    if (!searchId) {
      console.error("No search_id returned:", searchResponse.data);
      return res.status(500).json({ error: "Failed to start search", details: searchResponse.data });
    }

    return res.json({ search_id: searchId });
  } catch (err) {
    console.error("Aviasales /search error:", err.response?.data || err.message);
    return res.status(500).json({ error: "Search init failed", details: err.response?.data || err.message });
  }
});

/* -------------------------------------------------------------------------- */
/* Get results (v1)                                                           */
/* -------------------------------------------------------------------------- */

router.get("/results/:searchId", async (req, res) => {
  try {
    const { searchId } = req.params;
    if (!searchId) return res.status(400).json({ error: "searchId required" });

    const resultsResponse = await axios.get(V1_RESULTS_API, {
      params: { uuid: searchId },
      headers: { Accept: "application/json" },
    });

    const resultsData = resultsResponse.data;

    let proposals = [];
    if (Array.isArray(resultsData)) proposals = resultsData;
    else if (Array.isArray(resultsData.data)) proposals = resultsData.data;
    else if (Array.isArray(resultsData.proposals)) proposals = resultsData.proposals;

    if (!proposals.length) {
      return res.json({ status: "pending", raw: resultsData });
    }

    const processed = proposals.map((p) => {
      const rawPrice = p.unified_price ?? p.price ?? p.value ?? null;
      const price = rawPrice !== null ? normalizePrice(rawPrice) : "N/A";
      const booking_link = p.link ? appendMarkerToUrl(p.link, MARKER) : null;

      return {
        id: p.id || p.search_id || null,
        airline: p.airline || "Multiple Airlines",
        origin: p.origin || "N/A",
        destination: p.destination || "N/A",
        departure_at: p.departure_at || null,
        arrival_at: p.arrival_at || null,
        price,
        currency: p.currency || "USD",
        booking_link,
      };
    });

    return res.json({ status: "complete", search_id: searchId, data: processed });
  } catch (err) {
    console.error("Aviasales /results error:", err.response?.data || err.message);
    return res.status(500).json({ error: "Results fetch failed", details: err.response?.data || err.message });
  }
});

export default router;
