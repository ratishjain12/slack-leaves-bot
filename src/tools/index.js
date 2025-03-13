// ✅ Tool Definition
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { Message } from "../models/message.model.js";

// Function to fetch attendance records
async function getAttendanceRecords({ user_id, filter }) {
  try {
    let query = {};
    if (user_id) query.user_id = user_id;

    if (filter === "leave") query.is_onleave = true;
    else if (filter === "wfh") query.is_working_from_home = true;
    else if (filter === "late") query.is_running_late = true;
    else if (filter === "all") {
      query.$or = [
        { is_onleave: true },
        { is_working_from_home: true },
        { is_running_late: true },
      ];
    }

    console.log("🔍 Querying DB with:", query); // Add debug log
    const records = await Message.find(query);
    console.log("📊 Retrieved Records:", records); // Debugging

    return records.length ? records : "No attendance records found.";
  } catch (error) {
    console.error("❌ Error fetching attendance records:", error);
    return "❌ Failed to fetch attendance records.";
  }
}

// ✅ Corrected Tool Definition using DynamicStructuredTool
const getAttendanceTool = new DynamicStructuredTool({
  name: "getAttendance",
  description:
    "Retrieve attendance records (leave, WFH, late arrivals). If no filter specified, returns all records.",

  schema: z.object({
    user_id: z.string().describe("The Slack user ID of the person"),
    filter: z
      .enum(["leave", "wfh", "late", "all"])
      .optional()
      .default("all")
      .describe(
        "Filter type: 'leave' for leaves, 'wfh' for work from home, 'late' for late arrivals, 'all' for everything"
      ),
  }),

  func: async ({ user_id, filter }) => {
    console.log("🔵 Received input:", { user_id, filter }); // Debugging log
    return await getAttendanceRecords({ user_id, filter });
  },
});

export { getAttendanceTool };
