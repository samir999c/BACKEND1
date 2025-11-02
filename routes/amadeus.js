import express from "express";
import fetch from "node-fetch";
import "dotenv/config";
import cors from "cors";

const router = express.Router();

// This file assumes your main app.js is already using cors()
// but adding it here provides an extra layer of safety.
router.use(cors());

// ========== Helper: Get Amadeus Token ==========
async function getAccessToken() {
  // This function will fail if .env variables are missing on your server
  try {
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
  } catch (err) {
    console.error("CRITICAL: getAccessToken failed. Check .env variables.", err.message);
    throw new Error("Auth token failed");
  }
}

// =====================================================
//  API ROUTES
// =====================================================

// 1. Airport and City Search
router.get("/airport-search", async (req, res) => {
  try {
    const { keyword } = req.query;
    if (!keyword || keyword.length < 2) {
      return res.status(400).json({ msg: "Keyword must be at least 2 chars." });
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

// 2. Flight Offers Search (UPDATED)
router.post("/flight-offers", async (req, res) => {
  try {
    const { 
      origin, 
      destination, 
      departureDate, 
      returnDate, 
      adults,
      children,       // NEW
      travelClass     // NEW
    } = req.body;

    const token = await getAccessToken();
    const url = new URL("https://test.api.amadeus.com/v2/shopping/flight-offers");
    
    // Build search params
    const searchParams = {
      originLocationCode: origin,
      destinationLocationCode: destination,
      departureDate: departureDate,
      adults: adults,
      currencyCode: "USD",
      max: 10,
    };

    // Conditionally add new params if they exist
    if (returnDate) {
      searchParams.returnDate = returnDate;
    }
    if (children > 0) {
      searchParams.children = children;
    }
    if (travelClass) {
      searchParams.travelClass = travelClass;
    }

    url.search = new URLSearchParams(searchParams);

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

// 4. Create Flight Orders (Booking) (UPDATED)
router.post("/book", async (req, res) => {
  try {
    const { flightOffer, travelerInfo } = req.body;
    const token = await getAccessToken();
    
    // Note: This only supports 1 traveler. You will need to update this logic
    // if you want to support multiple travelers (adults + children)
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
          // --- START OF CRITICAL FIX ---
          // Amadeus Test API requires dummy payment
          "payments": [
            {
              "method": "CREDIT_CARD",
              "card": {
                "vendorCode": "VI", // VI for Visa, CA for MasterCard
                "cardNumber": "4111111111111111", // Amadeus test card
                "expiryDate": "2030-01" // Any future date
              }
            }
          ],
          // Amadeus also requires a ticketing contact
          "ticketingContact": {
            "contact": {
              "emailAddress": travelerInfo.email,
              "phones": [
                {
                  "deviceType": "MOBILE",
                  "countryCallingCode": "1",
                  "number": travelerInfo.phone
                }
              ]
            },
            "addresseeName": {
              "firstName": travelerInfo.firstName,
              "lastName": travelerInfo.lastName
            }
          }
          // --- END OF CRITICAL FIX ---
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Amadeus Booking Error:", data);
      return res.status(response.status).json(data);
    }
    res.json(data);
  } catch (err) {
    console.error("Backend /book Error:", err.message);
    res.status(500).json({ msg: "Booking failed", error: err.message });
  }
});


// 5. Other Routes (Inspiration, Cheapest, etc.)
router.get("/flight-inspiration", async (req, res) => {
  try {
    const token = await getAccessToken();
    const { origin } = req.query;
    const url = `https://test.api.amadeus.com/v1/shopping/flight-destinations?origin=${origin}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (!response.ok) { return res.status(response.status).json(data); }
    res.json(data);
  } catch (err) {
    res.status(500).json({ msg: "Inspiration search failed", error: err.message });
  }
});

router.get("/flight-cheapest", async (req, res) => {
  try {
    const token = await getAccessToken();
    const { origin, destination } = req.query;
    const url = `https://test.api.amadeus.com/v1/shopping/flight-dates?origin=${origin}&destination=${destination}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (!response.ok) { return res.status(response.status).json(data); }
    res.json(data);
  } catch (err) {
    res.status(500).json({ msg: "Cheapest date search failed", error: err.message });
  }
});

router.get("/flight-status", async (req, res) => {
  try {
    const token = await getAccessToken();
    const { carrierCode, flightNumber, scheduledDepartureDate } = req.query;
    const url = `https://test.api.amadeus.com/v2/schedule/flights?carrierCode=${carrierCode}&flightNumber=${flightNumber}&scheduledDepartureDate=${scheduledDepartureDate}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (!response.ok) { return res.status(response.status).json(data); }
    res.json(data);
  } catch (err) {
    res.status(500).json({ msg: "Flight status failed", error: err.message });
  }
});

router.get("/airline", async (req, res) => {
  try {
    const token = await getAccessToken();
    const { airlineCode } = req.query;
    const url = `https://test.api.amadeus.com/v1/reference-data/airlines?airlineCodes=${airlineCode}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (!response.ok) { return res.status(response.status).json(data); }
    res.json(data);
  } catch (err) {
    res.status(500).json({ msg: "Airline lookup failed", error: err.message });
  }
});


// =====================================================
//  THE FIX FOR YOUR SERVER CRASH
//  This line MUST be at the very bottom of the file
// =====================================================
export default router;