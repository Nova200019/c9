/**
 * makeAdmin.js
 * 
 * Helper script to instantly grant an existing user the Admin role.
 * Usage: node serverUtils/makeAdmin.js <email>
 */

const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../backend/config/.env.production") });

const DBUrl = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/mydrive";

const userSchema = new mongoose.Schema({
  email: String,
  isAdmin: Boolean,
});
const User = mongoose.model("User", userSchema);

async function makeAdmin(email) {
  try {
    console.log(`Connecting to MongoDB...`);
    await mongoose.connect(DBUrl);
    
    console.log(`Finding user with email: ${email}...`);
    const user = await User.findOne({ email });
    
    if (!user) {
      console.log(`❌ User not found with email: ${email}`);
      process.exit(1);
    }

    user.isAdmin = true;
    await user.save();
    
    console.log(`✅ Success! User ${email} is now an Admin.`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
}

const emailArgs = process.argv.slice(2);
if (emailArgs.length === 0) {
  console.log("Usage: node serverUtils/makeAdmin.js <user-email>");
  process.exit(1);
}

makeAdmin(emailArgs[0]);
