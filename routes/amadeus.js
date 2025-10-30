import express from "express";
import fetch from "node-fetch";
import "dotenv/config";
import cors from "cors";

const app = express(); // Use 'app' instead of 'router' for the main export
const router = express.Router();

// =============================================
//  THE CORS FIX
// =============================================
// We apply CORS to the 'app' itself, which Vercel will use.
// This is a more robust setting that allows your frontend URL.
const corsOptions = {
  origin: process.env.FRONTEND_URL || "https://koalarouteai.com",
  credentials: true,
};
app.use(cors(corsOptions));
// Also enable pre-flight requests for all routes
app.options('*', cors(corsOptions)); 

// Parse JSON bodies
app.use(express.json());

// ========== Helper: Get Amadeus Token ==========
async function getAccessToken() {
  // ... (Your getAccessToken function is fine, no changes needed)
  const res = await fetch(
    "https://test.api.amadeus.com/v1/security/oauth2/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.AMADEUS_CLIENT_ID,
        client_secret: process.env.AMADEUS_CLIENT_SECRET,
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    console.error("Failed to get Amadeus token:", data);
    throw new Error(data.error_description || "Failed to get Amadeus token");
  }
  return data.access_token;
}

// =====================================================
//  ALL YOUR ROUTES (with robust error handling)
// =====================================================

// 1. Airport and City Search (The one that is failing)
router.get("/airport-search", async (req, res) => {
  try {
    const { keyword } = req.query;
    if (!keyword || keyword.length < 2) {
      return res.status(400).json({ msg: "Search keyword must be at least 2 characters." });
    }
    const token = await getAccessToken();
    const url = `https://test.api.amadeus.com/v1/reference-data/locations?subType=AIRPORT,CITY&keyword=${keyword}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (!response.ok) {
      console.error("Amadeus API Error (Airport Search):", data);
      return res.status(response.status).json(data);
    }
    res.json(data);
  } catch (err) {
    console.error("Backend Error (Airport Search):", err.message);
    res.status(500).json({ msg: "Airport search failed", error: err.message });
  }
});

// 2. Flight Offers Search
router.post("/flight-offers", async (req, res) => {
  try {
    const { origin, destination, departureDate, returnDate, adults } = req.body;
    const token = await getAccessToken();
    const url = new URL("https://test.api.amadeus.com/v2/shopping/flight-offers");
    url.search = new URLSearchParams({
      originLocationCode: origin,
      destinationLocationCode: destination,
      departureDate,
      ...(returnDate && { returnDate }),
      adults: adults || 1,
      currencyCode: "USD",
      max: 5,
    });
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (!response.ok) {
      console.error("Amadeus API Error (Flight Offers):", data);
      return res.status(response.status).json(data);
    }
    res.json(data);
  } catch (err) {
    console.error("Backend Error (Flight Offers):", err.message);
    res.status(500).json({ msg: "Flight search failed", error: err.message });
  }
});

// 3. Flight Offers Price
router.post("/flight-offers/price", async (req, res) => {
  try {
    const token = await getAccessToken();
    const response = await fetch("https://test.api.amadeus.com/v1/shopping/flight-offers/pricing", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ data: { type: "flight-offers-pricing", flightOffers: req.body.flightOffers } }),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error("Amadeus API Error (Price):", data);
      return res.status(response.status).json(data);
    }
    res.json(data);
  } catch (err) {
    console.error("Backend Error (Price):", err.message);
    res.status(500).json({ msg: "Price check failed", error: err.message });
  }
});

// 4. Create Flight Orders (Booking)
router.post("/book", async (req, res) => {
  try {
    const { flightOffer, travelerInfo } = req.body;
    const token = await getAccessToken();
    const response = await fetch("https://test.api.amadeus.com/v1/booking/flight-orders", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          type: "flight-order",
          flightOffers: [flightOffer],
          travelers: [
            {
              id: "1",
              dateOfBirth: travelerInfo.dateOfBirth,
              name: { firstName: travelerInfo.firstName, lastName: travelerInfo.lastName },
              gender: travelerInfo.gender,
              contact: {
                emailAddress: travelerInfo.email,
                phones: [{ deviceType: "MOBILE", countryCallingCode: "1", number: travelerInfo.phone }],
              },
              documents: [
                {
                  documentType: "PASSPORT",
                  number: travelerInfo.passportNumber,
                  expiryDate: travelerInfo.passportExpiry,
                  issuanceCountry: travelerInfo.passportCountry,
                  nationality: travelerInfo.passportCountry,
                  holder: true,
                },
              ],
            },
          ],
        },
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error("Amadeus API Error (Book):", data);
      return res.status(response.status).json(data);
    }
    res.json(data);
  } catch (err) {
    console.error("Backend Error (Book):", err.message);
    res.status(500).json({ msg: "Booking failed", error: err.message });
  }
});

// ... (Your other routes: inspiration, cheapest, status, airline)
// ... (I've omitted them for brevity, but they should also be inside the router)


// =====================================================
//  FINAL STEP: Mount the router and export the app
// =====================================================
// We mount all our API routes under the '/amadeus' prefix
app.use("/amadeus", router);

// This is the default export for Vercel
export default app;