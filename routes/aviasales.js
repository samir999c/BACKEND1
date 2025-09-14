import express from "express";
import axios from "axios";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

// Config / endpoints
const TOKEN = process.env.AVIASALES_API_KEY;
const MARKER = process.env.AVIASALES_MARKER;
const HOST = process.env.AVIASALES_HOST; // your live frontend/back-end domain
const V3_PRICES_API = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates";
const V1_SEARCH_API = "https://api.travelpayouts.com/v1/flight_search";
const V1_RESULTS_API = "https://api.travelpayouts.com/v1/flight_search_results";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function md5(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

// Generate signature: recursively collect values in alphabetical key order,
// flatten arrays/objects, join with ":" and compute md5(token + ":" + joinedValues)
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
    // attempt to safely add/replace marker query param
    const u = new URL(url);
    u.searchParams.set("marker", marker);
    return u.toString();
  } catch (e) {
    // fallback: naive append
    return url + (url.includes("?") ? "&" : "?") + `marker=${encodeURIComponent(marker)}`;
  }
}

function normalizePrice(raw) {
  // Safely produce a readable price string while avoiding wrong conversions.
  // Many Travelpayouts fields use "unified_price" in cents — if value >= 1000 assume cents.
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (raw > 1000) return (raw / 100).toFixed(2); // assume cents -> dollars
    return raw.toFixed ? raw.toFixed(2) : String(raw);
  }
  // if it's string already
  return String(raw);
}

/* -------------------------------------------------------------------------- */
/* Keep existing prices_for_dates endpoint (v3) — useful as fallback/calendar  */
/* -------------------------------------------------------------------------- */

router.get("/prices", async (req, res) => {
  try {
    if (!TOKEN) {
      return res.status(500).json({ error: "Server configuration error: API key is not set." });
    }

    const { origin, destination, departure_at, return_at, currency = "usd", limit = 30 } = req.query;
    if (!origin || !destination || !departure_at) {
      return res.status(400).json({ error: "Missing required query parameters: origin, destination, departure_at" });
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

    if (!response.data || response.data.success !== true) {
      return res.status(500).json({ error: "API request failed", details: response.data?.error || "Unknown" });
    }

    // return raw v3 data (frontend may treat it as price-calendar)
    return res.json({ data: response.data.data });
  } catch (err) {
    console.error("Aviasales /prices error:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to fetch flight prices", details: err.response?.data || err.message });
  }
});

/* -------------------------------------------------------------------------- */
/* Main flow: v1 flight_search  (initiate)                                    */
/* POST /aviasales/search                                                     */
/* body: { origin, destination, departure, returnDate?, passengers?, tripClass?, currency? } */
/* Returns: { search_id }                                                     */
/* -------------------------------------------------------------------------- */

router.post("/search", async (req, res) => {
  try {
    if (!TOKEN || !MARKER) {
      return res.status(500).json({ error: "Server configuration error: API key or marker missing." });
    }

    const {
      origin,
      destination,
      departure,      // YYYY-MM-DD expected
      returnDate,    // optional
      passengers = 1,
      children = 0,
      infants = 0,
      tripClass = "Y",
      currency = "USD",
    } = req.body;

    if (!origin || !destination || !departure) {
      return res.status(400).json({ error: "Origin, destination and departure date are required." });
    }

    // prepare segments
    const segments = [
      { origin: origin.toUpperCase(), destination: destination.toUpperCase(), date: departure },
    ];
    if (returnDate) {
      segments.push({ origin: destination.toUpperCase(), destination: origin.toUpperCase(), date: returnDate });
    }

    const passengersObj = { adults: parseInt(passengers) || 1, children: parseInt(children) || 0, infants: parseInt(infants) || 0 };

    // host must match value registered in Travelpayouts dashboard for signature correctness
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

    const payload = { ...signatureParams, signature };

    // note: v1 requires X-Access-Token header for authorization
    const searchResponse = await axios.post(V1_SEARCH_API, payload, {
      headers: { "Content-Type": "application/json", "X-Access-Token": TOKEN },
    });

    const searchData = searchResponse.data;
    const searchId = searchData?.search_id || searchData?.uuid || null;
    if (!searchId) {
      console.error("No search_id returned:", searchData);
      return res.status(500).json({ error: "Failed to initialize search. No search_id returned.", details: searchData });
    }

    return res.json({ search_id: searchId });
  } catch (err) {
    console.error("Aviasales /search error:", err.response?.data || err.message);
    return res.status(500).json({ error: "Flight search initialization failed", details: err.response?.data || err.message });
  }
});

/* -------------------------------------------------------------------------- */
/* Results endpoint - check v1 results for a given search_id                   */
/* GET /aviasales/results/:searchId                                           */
/* Returns: { status: "pending", raw: <api response> }  OR                    */
/*          { status: "complete", search_id, data: [ { ..processed flight } ] }*/
/* -------------------------------------------------------------------------- */

router.get("/results/:searchId", async (req, res) => {
  try {
    const { searchId } = req.params;
    const currencyRequested = (req.query.currency || "USD").toUpperCase();
    const passengers = parseInt(req.query.passengers || "1");

    if (!searchId) return res.status(400).json({ error: "searchId required in path" });
    if (!TOKEN) return res.status(500).json({ error: "Server configuration error: API key missing." });

    const resultsResponse = await axios.get(V1_RESULTS_API, {
      params: { uuid: searchId },
      headers: { "X-Access-Token": TOKEN, "Accept-Encoding": "gzip, deflate" },
    });

    const resultsData = resultsResponse.data;

    // determine proposals array in a few shapes the API might return
    let proposals = [];
    if (Array.isArray(resultsData)) proposals = resultsData;
    else if (Array.isArray(resultsData.data)) proposals = resultsData.data;
    else if (Array.isArray(resultsData.proposals)) proposals = resultsData.proposals;
    else proposals = resultsData.proposals || [];

    // if still empty -> return pending with raw response (frontend can poll)
    if (!proposals.length) {
      return res.json({ status: "pending", raw: resultsData });
    }

    // process proposals into frontend-friendly structure
    const conversionRates = { USD: 1, EUR: 0.9, GBP: 0.8 };
    const rate = conversionRates[currencyRequested] || 1;

    const processed = proposals.map((p) => {
      // try a few common places to find price and link
      const rawPrice = p.unified_price ?? p.price ?? p.value ?? p.min_price ?? null;
      const priceDisplay = rawPrice !== null ? normalizePrice(rawPrice * (1) /* do not multiply by passengers here unless you want total */) : null;
      const currency = p.currency || currencyRequested;

      // booking link - if provided by API, append marker; otherwise leave null
      const candidateLink = p.link || p.booking_link || p.booking_url || p.site_link || null;
      const booking_link = candidateLink ? appendMarkerToUrl(candidateLink, MARKER) : null;

      return {
        id: p.id || p.search_id || null,
        airline: p.airline || p.carrier || "Multiple Airlines",
        origin: p.origin || p.segments?.[0]?.origin || "N/A",
        destination: p.destination || (p.segments ? p.segments.slice(-1)[0]?.destination : "N/A"),
        departure_at: p.departure_at || p.departure_time || null,
        arrival_at: p.arrival_at || p.arrival_time || null,
        raw_price: rawPrice ?? null,
        price: priceDisplay ?? "N/A",
        currency,
        passengers,
        booking_link: booking_link, // already contains marker param when possible
        raw: p, // include raw proposal so frontend can inspect everything if desired
      };
    });

    return res.json({ status: "complete", search_id: searchId, data: processed });
  } catch (err) {
    console.error("Aviasales /results error:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to fetch results", details: err.response?.data || err.message });
  }
});

export default router;
