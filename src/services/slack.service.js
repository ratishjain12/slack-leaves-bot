const { App } = require("@slack/bolt");
const { Message, leaveSchema } = require("../models/message.model");
const env = require("../config/env");
const { classifyLeaveMessage } = require("./openai.service");

// Initialize Slack App
const app = new App({
  token: env.SLACK_BOT_TOKEN,
  signingSecret: env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: env.SLACK_APP_TOKEN,
  port: env.PORT,
});

// Listen for messages and save them to MongoDB
app.event("message", async ({ event, client }) => {
  try {
    if (!event.subtype) {
      console.log(`📩 Message from ${event.user}: ${event.text}`);

      const userInfo = await client.users.info({
        user: event.user,
      });
      console.log("👤 User Info:", userInfo.user.real_name);

      const classifiedMessage = await classifyLeaveMessage(
        userInfo,
        event.text,
        event.ts
      );

      const validate = leaveSchema.safeParse(classifiedMessage);

      if (validate.success) {
        await new Message(validate.data).save();
      } else {
        console.log("❌ Error validating the json response from openai");
        console.log(validate.error);
      }
    }
  } catch (error) {
    console.error("❌ Error handling message:", error);
  }
});

module.exports = app;
