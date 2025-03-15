import pkg from "@slack/bolt";
import { Message, leaveSchema } from "../models/message.model.js";
import { env } from "../config/env.js";
import {
  classifyLeaveMessage,
  classifyMessageType,
  runAttendanceAgent,
} from "./openai.service.js";

// Helper function to get a human-readable status string
function getStatusString(entry) {
  if (entry.is_working_from_home) return "Working From Home";
  if (entry.is_onleave) return "On Leave";
  if (entry.is_leaving_early) return "Leaving Early";
  if (entry.is_running_late) return "Running Late";
  if (entry.is_out_of_office) return "Out of Office";
  if (entry.is_on_half_day) return "On Half Day";
  return "Unknown Status";
}

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

  // Handle message edits
  if (event.subtype === "message_changed") {
    const messageReceived = event.message.text;
    const messageType = await classifyMessageType(messageReceived);
    console.log("Edit - Message Type:", messageType);

    if (messageType === "leave") {
      try {
        const userInfo = await client.users.info({
          user: event.message.user,
        });

        const classifiedMessage = await classifyLeaveMessage(
          userInfo,
          messageReceived
        );

        const validate = leaveSchema.safeParse(classifiedMessage);

        if (validate.success) {
          // Ensure we're using the original message timestamp
          validate.data.timestamp = event.message.ts;

          // Find the existing entry by timestamp
          const existingEntry = await Message.findOne({
            user_id: validate.data.user_id,
          });

          if (existingEntry) {
            console.log("Edit - Found existing entry:", existingEntry);
            const oldStatus = getStatusString(existingEntry);
            const newStatus = getStatusString(validate.data);

            // Update all fields except _id and timestamps
            Object.keys(validate.data).forEach((key) => {
              if (key !== "_id") {
                existingEntry[key] = validate.data[key];
              }
            });

            const savedEntry = await existingEntry.save();

            await say(
              `Message edited: Updated your status from '${oldStatus}' to '${newStatus}'`
            );
          } else {
            // If no entry found with exact timestamp, create a new one
            await new Message(validate.data).save();
            await say(
              `Created new entry with status: '${getStatusString(
                validate.data
              )}'`
            );
          }
        } else {
          console.log("Edit - Validation error:", validate.error);
        }
      } catch (error) {
        console.error("❌ Error handling edited message:", error);
      }
    }
    return;
  }

  const messageReceived = event.text;
  const messageType = await classifyMessageType(messageReceived);

  if (messageType !== "leave" && !messageReceived.startsWith("!query")) {
    return;
  }

  if (messageType === "leave") {
    try {
      if (!event.subtype) {
        console.log(`📩 Message from ${event.user}: ${messageReceived}`);

        const userInfo = await client.users.info({
          user: event.user,
        });
        console.log("👤 User Info:", userInfo.user.real_name);
        console.log("🕒 Timestamp:", event.ts);

        const classifiedMessage = await classifyLeaveMessage(
          userInfo,
          messageReceived
        );

        const validate = leaveSchema.safeParse(classifiedMessage);

        if (validate.success) {
          // Check for any existing entry on the same day
          const startOfDay = new Date(
            validate.data.leave_day || validate.data.timestamp
          );
          startOfDay.setHours(0, 0, 0, 0);

          const endOfDay = new Date(startOfDay);
          endOfDay.setHours(23, 59, 59, 999);

          const existingEntry = await Message.findOne({
            user_id: validate.data.user_id,
            $or: [
              { leave_day: { $gte: startOfDay, $lte: endOfDay } },
              {
                timestamp: {
                  $gte: startOfDay.toISOString(),
                  $lte: endOfDay.toISOString(),
                },
              },
            ],
          });

          if (existingEntry) {
            // If status is different, update the existing entry
            if (
              existingEntry.is_working_from_home !==
                validate.data.is_working_from_home ||
              existingEntry.is_onleave !== validate.data.is_onleave ||
              existingEntry.is_leaving_early !==
                validate.data.is_leaving_early ||
              existingEntry.is_running_late !== validate.data.is_running_late ||
              existingEntry.is_out_of_office !==
                validate.data.is_out_of_office ||
              existingEntry.is_on_half_day !== validate.data.is_on_half_day
            ) {
              const oldStatus = getStatusString(existingEntry);
              const newStatus = getStatusString(validate.data);

              // Update all fields from the new entry
              Object.assign(existingEntry, validate.data);
              await existingEntry.save();

              await say(
                `Updated your status for today from '${oldStatus}' to '${newStatus}'. Previous message was: "${existingEntry.original_text}"`
              );
              return;
            } else {
              await say(
                `You already have a similar entry for today. Your previous message was: "${existingEntry.original_text}"`
              );
              return;
            }
          }

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
    if (!messageReceived.startsWith("!query")) {
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
