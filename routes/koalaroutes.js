import express from "express";
import fetch from "node-fetch";
import { authMiddleware } from "../middleware/auth.js";
import "dotenv/config";

const router = express.Router();
const DUFFEL_TOKEN = process.env.DUFFEL_ACCESS_TOKEN;

// --- JSON parsing helper ---
async function safeJsonParse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid API response: ${text.substring(0, 150)}...`);
  }
}

// --- Endpoint for Dashboard Authentication Check ---
router.get("/dashboard", authMiddleware, (req, res) => {
  try {
    res.json({ msg: "Authentication successful!" });
  } catch (error) {
    console.error("Dashboard route error:", error);
    res.status(500).json({ error: "Dashboard error" });
  }
});

// --- Endpoint 1: Create an Offer Request (Duffel equivalent of flight search init) ---
router.post("/flights", authMiddleware, async (req, res) => {
  try {
    if (!DUFFEL_TOKEN) {
      return res.status(500).json({ error: "Missing Duffel API token" });
    }

    const {
      origin,
      destination,
      departure_at,
      return_at,
      passengers = 1,
      trip_class = "economy",
    } = req.body;

    if (!origin || !destination || !departure_at) {
      return res.status(400).json({ error: "Missing required search parameters" });
    }

    const slices = [{ origin, destination, departure_date: departure_at }];
    if (return_at) {
      slices.push({
        origin: destination,
        destination: origin,
        departure_date: return_at,
      });
    }

    const requestPayload = {
      slices,
      passengers: Array.from({ length: passengers }, () => ({ type: "adult" })),
      cabin_class: trip_class.toLowerCase(),
    };

    const searchResponse = await fetch("https://api.duffel.com/air/offer_requests", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${DUFFEL_TOKEN}`,
        "Content-Type": "application/json",
        "Duffel-Version": "beta",
      },
      body: JSON.stringify(requestPayload),
    });

    const searchData = await safeJsonParse(searchResponse);

    if (searchResponse.status >= 400) {
      throw new Error(searchData.errors?.[0]?.message || "Duffel search failed.");
    }

    res.json({
      offer_request_id: searchData.data.id,
      offers: searchData.data.offers,
    });
  } catch (err) {
    console.error("Duffel Init Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Endpoint 2: Fetch Offers by OfferRequestId (Duffel polling) ---
router.get("/flights/:offerRequestId", authMiddleware, async (req, res) => {
  try {
    if (!DUFFEL_TOKEN) {
      return res.status(500).json({ error: "Missing Duffel API token" });
    }

    const { offerRequestId } = req.params;

    const resultsResponse = await fetch(
      `https://api.duffel.com/air/offer_requests/${offerRequestId}`,
      {
        headers: {
          "Authorization": `Bearer ${DUFFEL_TOKEN}`,
          "Duffel-Version": "beta",
        },
      }
    );

    const resultsData = await safeJsonParse(resultsResponse);

    if (resultsResponse.status >= 400) {
      throw new Error(resultsData.errors?.[0]?.message || "Failed to fetch Duffel offers.");
    }

    res.json({
      status: "complete",
      data: resultsData.data.offers,
    });
  } catch (err) {
    console.error("Duffel Poll Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
