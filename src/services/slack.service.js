import pkg from "@slack/bolt";
import { Message, leaveSchema } from "../models/message.model.js";
import { env } from "../config/env.js";
import { classifyLeaveMessage, runAttendanceAgent } from "./openai.service.js";

// Initialize Slack App
const app = new pkg.App({
  token: env.SLACK_BOT_TOKEN,
  signingSecret: env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: env.SLACK_APP_TOKEN,
  port: env.PORT,
});

// Listen for messages and save them to MongoDB
app.event("message", async ({ event, client, say }) => {
  try {
    if (!event.subtype && !event.text.startsWith("!query")) {
      console.log(`📩 Message from ${event.user}: ${event.text}`);

      const userInfo = await client.users.info({
        user: event.user,
      });
      console.log("👤 User Info:", userInfo.user.real_name);
      console.log("🕒 Timestamp:", event.ts);

      const classifiedMessage = await classifyLeaveMessage(
        userInfo,
        event.text
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

  try {
    // Ensure the message starts with !query
    if (!event.text.startsWith("!query")) {
      return;
    }

    // Extract query by removing "!query" from the beginning
    let query = event.text.replace(/^!query\s*/, "").trim();
    if (!query) {
      return await say(
        "❌ Please provide a query. Example: `!query @user leave records`"
      );
    }

    // Extract user mention if present
    const mentionRegex = /<@([A-Z0-9]+)>/;
    const match = query.match(mentionRegex);
    let user_id = null;

    if (match) {
      user_id = match[1];
      query = query.replace(mentionRegex, "").trim();

      try {
        const userInfo = await client.users.info({ user: user_id });
        user_id = userInfo.user.id;
      } catch (error) {
        console.error("❌ Error fetching user info:", error);
        return await say("❌ Failed to retrieve user details.");
      }
    }

    // Modify the query to include User ID if applicable
    const modifiedQuery = user_id
      ? `User ID: ${user_id}, Query: ${query}`
      : query;

    console.log("🔍 Modified Query:", modifiedQuery);

    const response = await runAttendanceAgent(modifiedQuery);

    console.log("🔍 Response:", response);

    return await say(`📊 **Attendance Report:**\n${response}`);
  } catch (error) {
    console.error("❌ Error processing attendance query:", error);
  }
});

export { app };
