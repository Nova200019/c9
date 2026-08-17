import mongoose from "mongoose";
import * as dotenv from "dotenv";
import UserProfile from "../models/user-profile-model";
import User from "../models/user-model";

dotenv.config();

const MONGO_URI = process.env.MONGODB_URL || "mongodb://localhost:27017/cloud9";

async function createSuperUser() {
  const args = process.argv.slice(2);
  const targetUsername = args[0];

  if (!targetUsername) {
    console.error("Usage: npx ts-node scripts/create-superuser.ts <username_or_email>");
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGO_URI);
    console.log(`Connected to MongoDB at ${MONGO_URI}`);

    // Find the user by email
    const user = await User.findOne({ email: targetUsername });

    if (!user) {
      console.error(`Error: User with email '${targetUsername}' not found in the database.`);
      process.exit(1);
    }

    const userId = user._id.toString();

    // Check if profile exists, otherwise create it
    let profile = await UserProfile.findOne({ userId });
    
    if (!profile) {
      console.log(`User profile not found for ${targetUsername}. Creating one...`);
      profile = await UserProfile.create({
        userId,
        tenantId: userId, // Assuming default tenant structure
        displayName: user.email.split("@")[0],
      });
    }

    // Upgrade to Admin tier
    profile.rateLimit.tier = "admin";
    
    // Admins get basically unlimited limits, but we can also set the default env values
    const msgLimit = parseInt(process.env.TIER_ADMIN_MSG_LIMIT || "999999", 10);
    const toolLimit = parseInt(process.env.TIER_ADMIN_TOOL_LIMIT || "999999", 10);
    const tokenLimit = parseInt(process.env.TIER_ADMIN_TOKEN_LIMIT || "999999999", 10);

    profile.rateLimit.dailyMessagesLimit = msgLimit;
    profile.rateLimit.dailyToolUsesLimit = toolLimit;
    profile.rateLimit.dailyTokensLimit = tokenLimit;
    profile.rateLimit.codeExecutionEnabled = true;
    profile.rateLimit.agentsEnabled = true;
    profile.rateLimit.lastResetAt = new Date(); // Reset their daily counters

    await profile.save();

    console.log(`✅ Success! User '${targetUsername}' (ID: ${userId}) has been upgraded to 'admin' tier.`);
    console.log(`Limits set to:`);
    console.log(`- Daily Messages: ${msgLimit}`);
    console.log(`- Daily Tools: ${toolLimit}`);
    console.log(`- Daily Tokens: ${tokenLimit}`);
    console.log(`- Code Execution / Agents: ENABLED`);
    
    process.exit(0);
  } catch (err) {
    console.error("Error creating super user:", err);
    process.exit(1);
  }
}

createSuperUser();
