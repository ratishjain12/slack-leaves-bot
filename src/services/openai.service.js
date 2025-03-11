const { OpenAI, ChatOpenAI } = require("@langchain/openai");
const { StructuredOutputParser } = require("langchain/output_parsers");
const { OPENAI_API_KEY } = require("../config/env");
const { leaveSchema } = require("../models/message.model.js");
const {
  createOpenAIFunctionsAgent,
  AgentExecutor,
} = require("langchain/agents");

const chatOpenAI = new ChatOpenAI({
  model: "gpt-4o",
  temperature: 0,
  apiKey: OPENAI_API_KEY,
});

console.log(leaveSchema);

const parser = StructuredOutputParser.fromZodSchema(leaveSchema);

async function classifyLeaveMessage(userInfo, message) {
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
    ${parser.getFormatInstructions()}`;

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

module.exports = { classifyLeaveMessage, parseLeaveMessage };
