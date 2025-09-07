// import mongoose from "mongoose";

// const userSchema = new mongoose.Schema({
//   name: { type: String },
//   email: { type: String, required: true, unique: true },
//   password: { type: String, required: true },
// });

// const UserModel = mongoose.models.User || mongoose.model("User", userSchema);

// export default UserModel;

import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});

export default mongoose.model("User", userSchema);
