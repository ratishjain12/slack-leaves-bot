import { ChatOpenAI } from "@langchain/openai";
import {
  StructuredOutputParser,
  OutputFixingParser,
} from "langchain/output_parsers";
import { env } from "../config/env.js";
import { leaveSchema } from "../models/message.model.js";
import { getAttendanceTool } from "../tools/index.js";

const chatOpenAI = new ChatOpenAI({
  model: "gpt-4",
  temperature: 0.5,
  apiKey: env.OPENAI_API_KEY,
});

// Create a second instance with lower temperature for fixing
const fixerModel = new ChatOpenAI({
  model: "gpt-4", // You could use 3.5-turbo here if you want to save tokens
  temperature: 0.1, // Lower temperature for more deterministic fixes
  apiKey: env.OPENAI_API_KEY,
});

const parser = StructuredOutputParser.fromZodSchema(leaveSchema);
// Create a fixing parser using OpenAI
const parserWithFix = OutputFixingParser.fromLLM(fixerModel, parser);

export async function classifyLeaveMessage(userInfo, message) {
  const currentDate = new Date();
  const formattedCurrentDate = currentDate.toISOString().split("T")[0]; // YYYY-MM-DD
  const officeStartTime = "09:00:00";
  const officeEndTime = "18:00:00";
  const currentMonth = currentDate.toLocaleString("default", { month: "long" });

  // Get current timestamp with full precision
  const currentTimestamp = new Date().toISOString();

  const prompt = `Classify the following message and extract structured data:
  
    Message: "${message}"
    User id: ${userInfo.user.id}
    User: ${userInfo.user.real_name}
    Current Date: ${formattedCurrentDate}
    Current Month: ${currentMonth}
    Current Exact Time: ${currentTimestamp}

    **Office Hours**
    - Start Time: ${officeStartTime}
    - End Time: ${officeEndTime}
  
    **Rules for Classification:**
    - If the message is about **leaving early**, set \`is_leaving_early: true\`.
      - If a date is mentioned (e.g., "15th", "March 15th"), extract it.
      - Detect phrases like "leaving early", "ducking out early", "heading out ahead of schedule", "taking off early", 
        "cutting out early", "slipping away early", "making an early exit", "departing before the usual time", 
        "clocking out early", "knocking off early", "heading home early", "calling it a day early", "wrapping up early", 
        "stepping out before closing time", "bowing out early".
    - If the message is about **leave**, set \`is_onleave: true\`.  
      - If a date is mentioned (e.g., "15th", "March 15th"), extract it.  
      - If **only the day is mentioned** (e.g., "15th"), assume the **current month and year**.  
      - If **no date is provided**, assume the **current date** (${formattedCurrentDate}).  
      - Detect phrases like:
        - **Casual phrases:** "taking leave", "on leave", "off work", "off for the day", "taking the day off", "out for the day", "off duty".
        - **Formal phrases:** "on vacation", "annual leave", "personal leave", "paid time off", "unavailable today", "leave of absence".
        - **Sick leave:** "on sick leave", "calling in sick", "not feeling well today", "taking a sick day", "medical leave".
        - **Miscellaneous:** "won't be in", "not coming to work", "skipping work", "not showing up today", "out of the office for the day".
    - If the message is about **running late**, set \`is_running_late: true\`.  
      - If a time is mentioned (e.g., "arriving at 10 AM", "reaching by 9:45"), extract it.  
      - Synonyms: "getting late", "delayed", "stuck in traffic", "arriving late", "held up", "reaching late", "coming in late", "won't make it on time".
      - Detect phrases like:
        - **Common phrases:** "running late", "getting late", "coming in late", "arriving late", "reaching late", "won't make it on time", "delayed".
        - **Traffic-related:** "stuck in traffic", "held up in traffic", "caught in congestion", "heavy traffic", "slow commute".
        - **Transportation issues:** "missed the bus", "missed my train", "train delay", "subway delay", "car broke down", "waiting for Uber".
        - **General excuses:** "held up", "got caught up", "got delayed", "something came up", "taking longer than expected", "won't be on time".
      - Ensure the time is after office start time (9:00 AM).  
    - If the message is about **Work From Home (WFH)**, set \`is_working_from_home: true\`.  
      - If a specific date is mentioned, use it.  
      - If no date is given, assume **current date** (${formattedCurrentDate}).  
    - If the message is about **Out of Office (OOO)**, set \`is_out_of_office: true\`.  
      - If a duration is mentioned (e.g., "out for 3 hours"), set **start_time = timestamp** and **end_time = timestamp + duration**.  
      - Detect phrases like:
        - **Common phrases:** "out of office", "OOO", "not in office", "away from office", "stepping out", "out for a while", "afk", "taking a break", "on tea break", "away from keyboard".
        - **Meeting-related:** "attending a meeting", "in a client meeting", "offsite meeting", "in an external meeting".
        - **Work errands:** "on a work trip", "traveling for work", "business travel", "visiting a client", "site visit".
        - **Personal reasons:** "out for an appointment", "running an errand", "stepping out for a while", "won't be at my desk".
        - **Unavailable due to events:** "offsite training", "conference day", "attending a seminar", "out for an event".
      - If no duration is mentioned, do not add start_time and end_time.
    - Only set leave_day if the message is about leave.
    
    **CRITICAL TIMESTAMP FORMATTING INSTRUCTIONS:**
    1. For the "timestamp" field: ALWAYS use the exact current time "${currentTimestamp}" - do not modify it
    2. For all date fields (leave_day, etc.): ALWAYS include the timezone "Z" at the end
    3. NEVER use "T00:00:00" (midnight) for the timestamp field - use the current time
    
    **Return JSON in this format:**
    ${parser.getFormatInstructions()}

    **Example of correctly formatted timestamp:**
    "timestamp": "${currentTimestamp}"

    **CRITICAL: You must always return valid JSON fenced by a markdown code block. Do not return any additional text.**`;

  try {
    // First attempt with regular parser
    const response = await chatOpenAI.invoke([
      { role: "user", content: prompt },
    ]);
    console.log("Raw AI Response:", response.content);

    try {
      // Try direct parsing first
      const parsed = await parser.parse(response.content);
      console.log("Successfully parsed with direct parser:", parsed);

      return {
        ...parsed,
        user_id: userInfo.user.id,
        user: userInfo.user.real_name,
        original_text: message,
      };
    } catch (directParseError) {
      console.warn(
        "Direct parsing failed, trying fixing parser:",
        directParseError
      );

      try {
        // Try fixing parser as backup
        const parsedWithFix = await parserWithFix.parse(response.content);
        console.log("Successfully parsed with fixing parser:", parsedWithFix);

        return {
          ...parsedWithFix,
          user_id: userInfo.user.id,
          user: userInfo.user.real_name,
          original_text: message,
        };
      } catch (fixParseError) {
        console.error("Both parsers failed:", fixParseError);
        throw new Error("Failed to parse message output");
      }
    }
  } catch (error) {
    console.error("Error classifying message:", error);
    throw new Error("Failed to classify message");
  }
}

const llmWithTools = chatOpenAI.bindTools([getAttendanceTool]);
const toolsByName = {
  getAttendance: getAttendanceTool,
};

export async function runAttendanceAgent(query) {
  console.log("🔍 Running attendance agent with query:", query);

  // Invoke the agent
  const result = await llmWithTools.invoke(query);
  console.log("🔍 Raw Result from Agent:", result);

  let rawResponses = [];

  if (result.tool_calls && result.tool_calls.length > 0) {
    for (const toolCall of result.tool_calls) {
      const selectedTool = toolsByName[toolCall.name];

      if (selectedTool) {
        console.log(
          `🛠️ Executing tool: ${toolCall.name} with args`,
          toolCall.args
        );

        const toolResponse = await selectedTool.invoke(toolCall.args);
        console.log(`📊 Raw Tool Response for ${toolCall.name}:`, toolResponse);

        rawResponses.push(toolResponse);
      }
    }
  }

  if (!rawResponses.length) {
    return "❌ No valid attendance records found.";
  }

  const formattedResponse = await chatOpenAI.invoke([
    {
      role: "system",
      content: `You are a Slack attendance bot. Format the attendance records using proper Slack message formatting conventions.

      Follow these formatting rules strictly:
      1. Start with a header using *bold* formatting
      2. Present statistics in a clear, bulleted format using •
      3. Use these specific emojis:
         - 🗓️ For the date period
         - 🌴 For leaves
         - 🏠 For WFH
         - ⏰ For late arrivals
      4. Use proper spacing between sections
      
      Format like this:
      *📊 Attendance Report*
      
      *Period: 🗓️ [Date Range]*
      
      *Summary:*
      • 🌴 Leaves: [number]
      • 🏠 WFH: [number]
      • ⏰ Late Arrivals: [number]

      Important:
      - Only include statistics that are present in the data
      - Keep the format consistent even with partial data
      - Use Slack's markdown, not regular markdown
      - Numbers should be presented clearly with their corresponding emojis
      - No additional text or explanations needed
      `,
    },
    {
      role: "user",
      content: `Attendance Records: ${JSON.stringify(rawResponses, null, 2)}`,
    },
  ]);

  console.log("📌 AI-Formatted Response:", formattedResponse.content);

  return formattedResponse.content || "❌ Failed to format attendance records.";
}
