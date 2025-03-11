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

async function classifyLeaveMessage(user, message, timestamp) {
  const prompt = `Classify the following message and extract structured data:
  
  Message: "${message}"
  Timestamp: ${timestamp}
  User: ${user}

  **Office Hours**
  - Start Time: 9:00 AM
  - End Time: 6:00 PM
  
  Determine the appropriate classification:
  - If the message is for working from home/wfh, set is_working_from_home to true.
  - If the message is for leave, set is_onleave to true.
  - If the message is for running late that is arriving at certain time which is after start time, set is_running_late to true.
  - If the message is about being out of office or user is saying ooo which means out of office, set is_out_of_office to true.

  in the case out of office, the start_time will be the timestamp and end_time will be the timestamp + the duration of the out of office mentioned in the 
  message, if not mentioned don't add start_time and end_time.

  also you should give reason for the classification.
  
  Return a JSON object with the following structure:
  ${parser.getFormatInstructions()}`;

  try {
    const response = await chatOpenAI.invoke([
      { role: "user", content: prompt },
    ]);
    console.log(response.content);
    const parsed = await parseLeaveMessage(user, message, response.content);
    return parsed;
  } catch (error) {
    console.error("Error classifying message:", error);
    throw new Error("Failed to classify message");
  }
}

async function parseLeaveMessage(user, originalText, rawOutput) {
  try {
    const parsed = await parser.parse(rawOutput);
    console.log("🔍 Parsed:", parsed);

    return {
      ...parsed,
      user: user,
      original_text: originalText,
    };
  } catch (error) {
    console.error("Error parsing message:", error);
    throw new Error("Failed to parse message output");
  }
}

module.exports = { classifyLeaveMessage, parseLeaveMessage };
