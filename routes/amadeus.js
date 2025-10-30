import express from "express";
import fetch from "node-fetch";
import "dotenv/config";
import cors from "cors";

const router = express.Router();

// =============================================
//  FIX 1: Simpler, more open CORS setting
// =============================================
// This allows all origins and will fix browser CORS errors.
router.use(cors());

// ========== Helper: Get Amadeus Token ==========
async function getAccessToken() {
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

/* =====================================================
    ✈️ 1. FLIGHT BOOKING SECTION
===================================================== */

// 1. Flight Offers Search
router.post("/flight-offers", async (req, res) => {
  try {
    const { origin, destination, departureDate, returnDate, adults } = req.body;
    const token = await getAccessToken();

    const url = new URL(
      "https://test.api.amadeus.com/v2/shopping/flight-offers"
    );
    url.search = new URLSearchParams({
      originLocationCode: origin,
      destinationLocationCode: destination,
      departureDate,
      ...(returnDate && { returnDate }),
      adults: adults || 1,
      currencyCode: "USD",
      max: 5,
    });

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    
    const data = await response.json();

    // =============================================
    //  FIX 2: Robust Error Handling
    // =============================================
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

// 2. Flight Offers Price
router.post("/flight-offers/price", async (req, res) => {
  try {
    const token = await getAccessToken();
    const response = await fetch(
      "https://test.api.amadeus.com/v1/shopping/flight-offers/pricing",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          data: {
            type: "flight-offers-pricing",
            flightOffers: req.body.flightOffers,
          },
        }),
      }
    );

    const data = await response.json();

    // =============================================
    //  FIX 2: Robust Error Handling
    // =============================================
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

// 3. Create Flight Orders (Booking)
router.post("/book", async (req, res) => {
  try {
    const { flightOffer, travelerInfo } = req.body;
    const token = await getAccessToken();

    const response = await fetch(
      "https://test.api.amadeus.com/v1/booking/flight-orders",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          data: {
            type: "flight-order",
            flightOffers: [flightOffer],
            travelers: [
              {
                id: "1",
                dateOfBirth: travelerInfo.dateOfBirth,
                name: {
                  firstName: travelerInfo.firstName,
                  lastName: travelerInfo.lastName,
                },
                gender: travelerInfo.gender,
                contact: {
                  emailAddress: travelerInfo.email,
                  phones: [
                    {
                      deviceType: "MOBILE",
                      countryCallingCode: "1", // You might want to make this dynamic
                      number: travelerInfo.phone,
                    },
                  ],
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
      }
    );

    const data = await response.json();

    // =============================================
    //  FIX 2: Robust Error Handling
    // =============================================
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

/* =====================================================
    💡 2. FLIGHT INSPIRATION SECTION
===================================================== */

// 1. Flight Inspiration Search
router.get("/flight-inspiration", async (req, res) => {
  try {
    const token = await getAccessToken();
    const { origin } = req.query;
    const url = `https://test.api.amadeus.com/v1/shopping/flight-destinations?origin=${origin}`;
    
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    
    const data = await response.json();

    // =============================================
    //  FIX 2: Robust Error Handling
    // =============================================
    if (!response.ok) {
      console.error("Amadeus API Error (Inspiration):", data);
      return res.status(response.status).json(data);
    }
    
    res.json(data);

  } catch (err) {
    console.error("Backend Error (Inspiration):", err.message);
    res
      .status(500)
      .json({ msg: "Inspiration search failed", error: err.message });
  }
});

// 2. Flight Cheapest Date Search
router.get("/flight-cheapest", async (req, res) => {
  try {
    const token = await getAccessToken();
    const { origin, destination } = req.query;
    const url = `https://test.api.amadeus.com/v1/shopping/flight-dates?origin=${origin}&destination=${destination}`;
    
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    
    const data = await response.json();

    // =============================================
    //  FIX 2: Robust Error Handling
    // =============================================
    if (!response.ok) {
      console.error("Amadeus API Error (Cheapest):", data);
      return res.status(response.status).json(data);
    }
    
    res.json(data);

  } catch (err) {
    console.error("Backend Error (Cheapest):", err.message);
    res
      .status(500)
      .json({ msg: "Cheapest date search failed", error: err.message });
  }
});

/* =====================================================
    🕒 3. FLIGHT SCHEDULE SECTION
===================================================== */

// 1. On Demand Flight Status
router.get("/flight-status", async (req, res) => {
  try {
    const token = await getAccessToken();
    const { carrierCode, flightNumber, scheduledDepartureDate } = req.query;

    const url = `https://test.api.amadeus.com/v2/schedule/flights?carrierCode=${carrierCode}&flightNumber=${flightNumber}&scheduledDepartureDate=${scheduledDepartureDate}`;
    
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    
    const data = await response.json();

    // =============================================
    //  FIX 2: Robust Error Handling
    // =============================================
    if (!response.ok) {
      console.error("Amadeus API Error (Status):", data);
      return res.status(response.status).json(data);
    }

    res.json(data);

  } catch (err) {
    console.error("Backend Error (Status):", err.message);
    res.status(500).json({ msg: "Flight status failed", error: err.message });
  }
});

/* =====================================================
    🏙️ 4. AIRPORT SECTION
===================================================== */

// 1. Airport and City Search
router.get("/airport-search", async (req, res) => {
  try {
    const { keyword } = req.query;
    if (!keyword || keyword.length < 2) {
      return res.status(400).json({ msg: "Search keyword must be at least 2 characters." });
    }
    
    const token = await getAccessToken();
    
    const url = `https://test.api.amadeus.com/v1/reference-data/locations?subType=AIRPORT,CITY&keyword=${keyword}`;
    
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    
    const data = await response.json();

    // =============================================
    //  FIX 2: Robust Error Handling (This is the critical one for you)
    // =============================================
    if (!response.ok) {
      console.error("Amadeus API Error (Airport Search):", data);
      return res.status(response.status).json(data);
    }
    
    res.json(data);

  } catch (err) {
    // This will catch errors from getAccessToken() (e.g. bad .env)
    console.error("Backend Error (Airport Search):", err.message);
    res.status(500).json({ msg: "Airport search failed", error: err.message });
  }
});

/* =====================================================
    🛩️ 5. AIRLINES SECTION
===================================================== */

// 1. Airline Code Lookup
router.get("/airline", async (req, res) => {
  try {
    const token = await getAccessToken();
    const { airlineCode } = req.query;
    const url = `https://test.api.amadeus.com/v1/reference-data/airlines?airlineCodes=${airlineCode}`;
    
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    
    const data = await response.json();

    // =============================================
    //  FIX 2: Robust Error Handling
    // =============================================
    if (!response.ok) {
      console.error("Amadeus API Error (Airline):", data);
      return res.status(response.status).json(data);
    }
    
    res.json(data);

  } catch (err) {
    console.error("Backend Error (Airline):", err.message);
    res.status(500).json({ msg: "Airline lookup failed", error: err.message });
  }
});

export default router;