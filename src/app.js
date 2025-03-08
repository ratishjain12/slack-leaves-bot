const connectDB = require("./config/database");
const app = require("./services/slack.service");
const env = require("./config/env");

// Connect to MongoDB
connectDB();

// Start Slack App
(async () => {
  await app.start();
  console.log(`🚀 Slack bot is running on port ${env.PORT}`);
})();
