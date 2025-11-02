// In your backend amadeus.js file

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
                      countryCallingCode: "1",
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

            // =============================================
            //  START OF CRITICAL FIX
            //  Amadeus requires a dummy payment for test bookings
            // =============================================
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
            // You also need to add a ticketing contact
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
            // =============================================
            //  END OF CRITICAL FIX
            // =============================================
          },
        }),
      }
    );

    const data = await response.json();
    
    // Use the robust error handling
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