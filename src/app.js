import { connectDB } from "./config/database.js";
import { app } from "./services/slack.service.js";
import { env } from "./config/env.js";

// Connect to MongoDB
await connectDB();

// Start Slack App
(async () => {
  await app.start();
  console.log(`🚀 Slack bot is running on port ${env.PORT}`);
})();
