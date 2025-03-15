import pkg from "@slack/bolt";
import { Message, leaveSchema } from "../models/message.model.js";
import { env } from "../config/env.js";
import {
  classifyLeaveMessage,
  classifyMessageType,
  runAttendanceAgent,
} from "./openai.service.js";

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
  console.log("event", event.channel);
  const messageType = await classifyMessageType(event.text);

  if (messageType !== "leave" && !event.text.startsWith("!query")) {
    return;
  }

  if (messageType === "leave") {
    try {
      if (!event.subtype) {
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
  }
  try {
    // Ensure the message starts with !query
    if (!event.text.startsWith("!query")) {
      return;
    }

    // Extract query by removing "!query" from the beginning
    let query = event.text;
    if (!query) {
      return await say(
        "❌ Please provide a query. Examples:\n" +
          "• `!query attendance @user` - Get attendance records for a user\n" +
          "• `!query team trends month wfh` - Get WFH trends for the month\n" +
          "• `!query team insights` - Get team attendance insights\n" +
          "• `!query predict @user next monday` - Predict attendance for a user\n" +
          "• `!query team calendar` - Get team calendar for current month"
      );
    }

    // Extract user mention if present
    const mentionRegex = /<@([A-Z0-9]+)>/;
    const match = query.match(mentionRegex);
    let user_id = null;

    if (match) {
      user_id = match[1];
      query = query.replace(mentionRegex, "@user").trim(); // Replace with @user placeholder for better agent understanding

      try {
        const userInfo = await client.users.info({ user: user_id });
        user_id = userInfo.user.id;
      } catch (error) {
        console.error("❌ Error fetching user info:", error);
        return await say("❌ Failed to retrieve user details.");
      }
    }

    // Enhance query with context and parameters
    let enhancedQuery = query;

    // Add user_id context if available
    if (user_id) {
      enhancedQuery = `${enhancedQuery} (user_id: ${user_id})`;
    }

    // Add date context if query contains date references
    const dateKeywords = [
      "today",
      "tomorrow",
      "yesterday",
      "next week",
      "this month",
      "last month",
      "last week",
      "this week",
    ];
    const monthNames = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ];

    // Check for date references in the query
    const hasDateReference =
      dateKeywords.some((keyword) => query.toLowerCase().includes(keyword)) ||
      monthNames.some((month) => query.toLowerCase().includes(month));

    if (hasDateReference) {
      const currentDate = new Date();
      enhancedQuery = `${enhancedQuery} (current date: ${
        currentDate.toISOString().split("T")[0]
      })`;
    }

    console.log("🔍 Enhanced Query:", enhancedQuery);

    // Process the query with the AI agent and get the formatted response
    const response = await runAttendanceAgent(enhancedQuery, event.channel);

    console.log("response for slack", response);
    // Send the response directly to Slack
    return await say(response);
  } catch (error) {
    console.error("❌ Error processing attendance query:", error);
    await say(
      "❌ Sorry, I encountered an error processing your query. Please try again."
    );
  }
});

export { app };
