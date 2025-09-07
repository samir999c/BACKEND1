// app/api/chat/route.js
import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();
const router = express.Router();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

router.post("/", async (req, res) => {
  try {
    const { user_query, history } = req.body;

    if (!user_query) {
      return res.status(400).json({ ai_response: "No query provided." });
    }

    // Convert messages to OpenAI roles
    const messages = history.map((msg) => ({
      role: msg.role === "ai" ? "assistant" : "user",
      content: msg.content,
    }));

    // Optional: add system prompt at the beginning
    messages.unshift({
      role: "system",
      content: "You are KoalaRoute AI, a helpful travel assistant.",
    });

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // or gpt-4 / gpt-3.5-turbo
      messages,
      max_tokens: 500,
    });

    const aiMessage =
      response.choices[0].message.content || "No response from AI";

    return res.json({ ai_response: aiMessage });
  } catch (error) {
    console.error("OpenAI API error:", error);
    return res
      .status(500)
      .json({ ai_response: "Error connecting to OpenAI API." });
  }
});

export default router; // ✅ default export
