const { App } = require("@slack/bolt");
const Message = require("../models/message.model");
const env = require("../config/env");

// Initialize Slack App
const app = new App({
  token: env.SLACK_BOT_TOKEN,
  signingSecret: env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: env.SLACK_APP_TOKEN,
  port: env.PORT,
});

// Listen for messages and save them to MongoDB
app.event("message", async ({ event }) => {
  try {
    if (!event.subtype) {
      console.log(`📩 Message from ${event.user}: ${event.text}`);

      const newMessage = new Message({
        user: event.user,
        text: event.text,
        ts: event.ts,
        channel: event.channel,
      });

      await newMessage.save();
    }
  } catch (error) {
    console.error("❌ Error handling message:", error);
  }
});

module.exports = app;
