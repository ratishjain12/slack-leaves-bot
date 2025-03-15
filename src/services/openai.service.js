import { ChatOpenAI } from "@langchain/openai";
import {
  StructuredOutputParser,
  OutputFixingParser,
} from "langchain/output_parsers";
import { env } from "../config/env.js";
import { leaveSchema } from "../models/message.model.js";
import {
  getAttendanceTool,
  getAttendanceTrendsTool,
  getTeamInsightsTool,
  predictAttendanceTool,
  getTeamCalendarTool,
} from "../tools/index.js";

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

// Configure LLM with all tools
const llmWithTools = chatOpenAI.bindTools([
  getAttendanceTool,
  getAttendanceTrendsTool,
  getTeamInsightsTool,
  predictAttendanceTool,
  getTeamCalendarTool,
]);

// Map of tools by name for easy lookup
const toolsByName = {
  getAttendance: getAttendanceTool,
  getAttendanceTrends: getAttendanceTrendsTool,
  getTeamInsights: getTeamInsightsTool,
  predictAttendance: predictAttendanceTool,
  getTeamCalendar: getTeamCalendarTool,
};

export async function runAttendanceAgent(query, channel) {
  console.log("🔍 Running attendance agent with query:", query, channel);

  // Create a system message that helps the model understand how to use the tools
  const systemMessage = {
    role: "system",
    content: `You are an intelligent attendance assistant for a Slack workspace. Your job is to help users get information about team attendance.

You have access to several tools:
1. getAttendance - Get attendance records for a specific user or all users with a particular status (leave, wfh, late, early)
2. getAttendanceTrends - Analyze attendance patterns over time (week, month, quarter)
3. getTeamInsights - Get comprehensive team attendance statistics for the current month
4. predictAttendance - Predict attendance patterns for a user on a specific date
5. getTeamCalendar - Generate a calendar view of team attendance for a specific month

Based on the user's query, select the most appropriate tool and provide the parameters it needs. 

*** Important: ***
If any date has been received in terms of yesterday, today, tomorrow, next week, etc., take reference from the current date with GMT +5:30 and please convert it to the actual date in YYYY-MM-DD format in args before using it in the tools, also same for days.

*** Important: ***
Please note that do not respond with text content always respond with tool structure output.

Common query patterns and the tools to use:
- "Who's on leave today?" → getAttendance with filter="leave" and no user_id
- "Who's leaving early today?" → getAttendance with filter="early" and no user_id
- "Show me @user's attendance" → getAttendance with user_id and filter="all"
- "What are the WFH trends this month?" → getAttendanceTrends with period="month" and type="wfh"
- "Give me team insights" → getTeamInsights
- "Will @user be in office next Monday?" → predictAttendance with user_id and date
- "Show me the team calendar for November" → getTeamCalendar with month="11"

Always try to extract parameters from the query. If a user mentions a specific person with @user, use their user_id. If they mention a time period, use that for date ranges. If they ask about "who" without specifying a user, assume they want information for all users.
`,
  };

  // Invoke the agent with the system message and user query
  const result = await llmWithTools.invoke([
    systemMessage,
    { role: "user", content: query },
  ]);

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

        const args = toolCall.args;

        // add channel to the args
        if (
          toolCall.name === "getTeamInsights" ||
          toolCall.name === "getAttendanceTrends"
        ) {
          args.channel_id = channel || undefined;
        }

        console.log("🛠️ Executing tool:", args);

        const toolResponse = await selectedTool.invoke(toolCall.args);
        console.log(`📊 Raw Tool Response for ${toolCall.name}:`, toolResponse);

        rawResponses.push({
          tool: toolCall.name,
          args: toolCall.args,
          response: toolResponse,
        });
      }
    }
  }

  if (!rawResponses.length) {
    return "❌ I couldn't find the information you're looking for. Please try rephrasing your query.";
  }

  // Format the response based on the tool type
  const formattedResponse = await formatToolResponse(rawResponses);
  return formattedResponse;
}

// Function to format tool responses based on their type
async function formatToolResponse(rawResponses) {
  // Determine the type of response to format
  const firstResponse = rawResponses[0];
  const toolName = firstResponse.tool;
  const toolResponse = firstResponse.response;

  // Create a formatting prompt based on the tool type
  let formattingPrompt = "";

  switch (toolName) {
    case "getAttendance":
      formattingPrompt = `Format the attendance records using proper Slack message formatting:
      1. Start with a header using *bold* formatting that includes the date
      2. If the response contains grouped records for all users:
         - Organize by attendance type (leave, WFH, late, early)
         - For each type, list all users with that status
         - Use appropriate emojis: 🌴 For leaves, 🏠 For WFH, ⏰ For late arrivals, �� For leaving early
      3. If the response is for a specific user:
         - Show their attendance status with appropriate emoji
         - Include any reason provided
      4. If no records are found, provide a friendly message`;
      break;

    case "getAttendanceTrends":
      formattingPrompt = `Format the attendance trends data for Slack:
      1. Start with a header "*📊 Attendance Trends*"
      2. Include the period and type of attendance being analyzed
      3. For each data point, create a visual bar using emoji (e.g., █████) to represent the count
      4. Sort chronologically and include the date and count for each point
      5. Add a brief summary of any notable patterns`;
      break;

    case "getTeamInsights":
      formattingPrompt = `Format the team insights for Slack:
      1. Start with a header "*📈 Team Insights*"
      2. Include the month/period being analyzed
      3. Present the summary statistics (total events, leaves, WFH, late arrivals)
      4. List the top users by event type with their statistics
      5. Use emojis to make the data visually appealing`;
      break;

    case "predictAttendance":
      formattingPrompt = `Format the attendance prediction for Slack:
      1. Start with a header "*🔮 Attendance Prediction*"
      2. Include the user's name and the date being predicted
      3. Show the probability percentages for different attendance types
      4. Include the confidence level of the prediction
      5. List any insights or patterns identified`;
      break;

    case "getTeamCalendar":
      formattingPrompt = `Format the team calendar for Slack:
      1. Start with a header "*📅 Team Calendar*"
      2. Include the month and year
      3. For each day with events, show the date and list who's on leave or WFH
      4. Group users by attendance type (leave vs WFH)
      5. Use emojis: 🌴 for leave, 🏠 for WFH`;
      break;

    default:
      formattingPrompt = `Format this attendance data for Slack using appropriate emojis and formatting.
      Make it visually clear and easy to read. Use bullet points and sections as needed.`;
  }

  // Add general formatting guidelines
  formattingPrompt += `

  General formatting guidelines:
  - Use Slack's markdown formatting (bold with *asterisks*, etc.)
  - Keep the message concise but informative
  - Use emojis appropriately to make the data visually appealing
  - Format dates in a user-friendly way
  - If the data is empty or "No records found", provide a friendly message
  - Don't add explanatory text about how you formatted the response
  
  For trend data, create ASCII charts using the █ character to visualize the data.
  For calendar data, organize by date with clear emoji indicators.
  For user mentions, use the format <@USER_ID> so Slack will properly display them.`;

  // Send to the LLM for formatting
  const formattingResponse = await chatOpenAI.invoke([
    {
      role: "system",
      content: formattingPrompt,
    },
    {
      role: "user",
      content: `Tool: ${toolName}\nArgs: ${JSON.stringify(
        firstResponse.args,
        null,
        2
      )}\nResponse: ${JSON.stringify(toolResponse, null, 2)}`,
    },
  ]);

  console.log("📌 AI-Formatted Response:", formattingResponse.content);
  return formattingResponse.content || "❌ Failed to format the response.";
}

export async function classifyMessageType(message) {
  const classificationPrompt = `
  Classify the following message into one of three categories:
  1. "leave" - If the message is about leave, working from home, arriving late, leaving early, afk, away from keyboard or out of office.
  2. attendance_query - If the message is requesting any kind of reports, trends, insight data or any message related analytics or information for example, who's on leave today?, who's leaving early today?, "show me @user's attendance
  for today, what are the WFH trends this month, show me attendance for March 15th, will @user be in office next Monday, show me the team calendar for November etc...".
  3. "normal" - If the message is unrelated to leave or attendance.

  Message: "${message}"

  Respond with ONLY one of the following: "leave", "attendance_query", or "normal".
  `;

  try {
    const response = await chatOpenAI.invoke([
      { role: "system", content: classificationPrompt },
    ]);

    const classification = response.content.trim().toLowerCase();

    console.log("classification", classification);

    if (["leave", "attendance_query", "normal"].includes(classification)) {
      return classification;
    }

    return "normal"; // Default to normal if classification fails
  } catch (error) {
    console.error("❌ Error classifying message:", error);
    return "normal"; // Default to normal on failure
  }
}
