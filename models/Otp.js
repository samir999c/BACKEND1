import mongoose from "mongoose";

const otpSchema = new mongoose.Schema({
  email: { type: String, required: true },
  otp: { type: String, required: true }, // hashed OTP
  attempts: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now, expires: 300 }, // auto-delete after 5 min
});

export default mongoose.model("Otp", otpSchema);
