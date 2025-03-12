import { ChatOpenAI } from "@langchain/openai";
import { StructuredOutputParser } from "langchain/output_parsers";
import { env } from "../config/env.js";
import { leaveSchema } from "../models/message.model.js";
import { getAttendanceTool } from "../tools/index.js";

const chatOpenAI = new ChatOpenAI({
  model: "gpt-4o",
  temperature: 0,
  apiKey: env.OPENAI_API_KEY,
});

const parser = StructuredOutputParser.fromZodSchema(leaveSchema);

export async function classifyLeaveMessage(userInfo, message) {
  const currentDate = new Date();
  const formattedCurrentDate = currentDate.toISOString().split("T")[0]; // YYYY-MM-DD
  const officeStartTime = "09:00:00";
  const officeEndTime = "18:00:00";
  const currentMonth = currentDate.toLocaleString("default", { month: "long" });
  const prompt = `Classify the following message and extract structured data:
  
    Message: "${message}"
    User id: ${userInfo.user.id}
    User: ${userInfo.user.real_name}
    Current Date: ${formattedCurrentDate}
    Current Month: ${currentMonth}

    **Office Hours**
    - Start Time: ${officeStartTime}
    - End Time: ${officeEndTime}
  
    **Rules for Classification:**
    - If the message is about **leave**, set \`is_onleave: true\`.  
      - If a date is mentioned (e.g., "15th", "March 15th"), extract it.  
      - If **only the day is mentioned** (e.g., "15th"), assume the **current month and year**.  
      - If **no date is provided**, assume the **current date** (${formattedCurrentDate}).  
      - Ensure the final leave day is formatted as **YYYY-MM-DD**.  
    - If the message is about **running late**, set \`is_running_late: true\`.  
      - If a time is mentioned (e.g., "arriving at 10 AM"), extract it.  
      - Ensure the time is after office start time (9:00 AM).  
    - If the message is about **Work From Home (WFH)**, set \`is_working_from_home: true\`.  
      - If a specific date is mentioned, use it.  
      - If no date is given, assume **current date** (${formattedCurrentDate}).  
    - If the message is about **Out of Office (OOO)**, set \`is_out_of_office: true\`.  
      - If a duration is mentioned (e.g., "out for 3 hours"), set **start_time = timestamp** and **end_time = timestamp + duration**.  
      - If no duration is mentioned, do not add start_time and end_time.  

    **Return JSON in this format:**
    ${parser.getFormatInstructions()}

    **Return JSON only, no other text or comments and in correct format.**`;

  try {
    const response = await chatOpenAI.invoke([
      { role: "user", content: prompt },
    ]);
    console.log("Raw AI Response:", response.content);

    const parsed = await parseLeaveMessage(userInfo, message, response.content);
    return parsed;
  } catch (error) {
    console.error("Error classifying message:", error);
    throw new Error("Failed to classify message");
  }
}

async function parseLeaveMessage(userInfo, originalText, rawOutput) {
  try {
    const parsed = await parser.parse(rawOutput);
    console.log("🔍 Parsed:", parsed);

    return {
      ...parsed,
      user_id: userInfo.user.id,
      user: userInfo.user.real_name,
      original_text: originalText,
    };
  } catch (error) {
    console.error("Error parsing message:", error);
    throw new Error("Failed to parse message output");
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
      content: `You are a helpful assistant. Format the following attendance records into a structured, readable report with stats of total  total leaves, total wfh, total late depending on the records:
      
      if records has only leaves data then in stats show only of leaves and no other stats similar for wfh and late.
      response should be in a such a away like it is a proper slack message.

      response should only the stats and no other text.
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
