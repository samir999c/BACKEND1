import express from 'express';
import { Duffel } from '@duffel/api';
import 'dotenv/config';

const router = express.Router();

// Initialize the Duffel client with your secret API key
const duffel = new Duffel({
  token: process.env.DUFFEL_ACCESS_TOKEN,
});

// Endpoint 1: Search for flights
router.post('/search', async (req, res) => {
  try {
    const { origin, destination, departure_date } = req.body;

    // Create a request for flight offers from Duffel
    const offerRequest = await duffel.offerRequests.create({
      slices: [{
        origin: origin,
        destination: destination,
        departure_date: departure_date,
      }],
      passengers: [{ type: 'adult' }], // Defaulting to 1 adult passenger
      cabin_class: 'economy',
    });
    
    // Retrieve the flight offers for that request
    const response = await duffel.offers.list({
      offer_request_id: offerRequest.data.id,
    });
    
    // Send the flight offers back to the frontend
    res.json({ data: response.data });

  } catch (error) {
    console.error("Duffel Search Error:", error);
    res.status(500).json({ error: 'Failed to search for flights.' });
  }
});

// Endpoint 2: Create a Duffel Link for booking
router.post('/create-link', async (req, res) => {
  try {
    const { offer_id } = req.body;
    
    // Create the unique Duffel Link for the chosen flight offer
    const duffelLink = await duffel.links.create({
      offer_id: offer_id,
    });

    // Send the unique booking URL back to the frontend
    res.json({ url: duffelLink.data.url });

  } catch (error) {
    console.error("Duffel Link Creation Error:", error);
    res.status(500).json({ error: 'Failed to create booking link.' });
  }
});

export default router;