// ✅ Tool Definition
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { Message } from "../models/message.model.js";
import { generateAndSendAttendanceCSV } from "../helpers/csv-helpers.js";

// Function to fetch attendance records
async function getAttendanceRecords({ user_id, filter, date }) {
  try {
    // Default to today if no date specified
    const queryDate = date ? new Date(date) : new Date();

    // Create date range for the specified day (start to end of day)
    const startOfDay = new Date(queryDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(queryDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Build the base query with date range
    let query = {
      timestamp: {
        $gte: startOfDay.toISOString(),
        $lte: endOfDay.toISOString(),
      },
    };

    // Add user_id filter if provided
    if (user_id) query.user_id = user_id;

    // Add status filter
    if (filter === "leave") query.is_onleave = true;
    else if (filter === "wfh") query.is_working_from_home = true;
    else if (filter === "late") query.is_running_late = true;
    else if (filter === "early") query.is_leaving_early = true;
    else if (filter === "all") {
      query.$or = [
        { is_onleave: true },
        { is_working_from_home: true },
        { is_running_late: true },
        { is_leaving_early: true },
      ];
    }

    console.log("🔍 Querying DB with:", query); // Add debug log
    const records = await Message.find(query);
    console.log("📊 Retrieved Records:", records); // Debugging

    // Format the response based on whether we're looking for a specific user or all users
    if (user_id) {
      // Single user query
      return records.length
        ? records
        : `No ${
            filter || "attendance"
          } records found for this user on ${queryDate.toDateString()}.`;
    } else {
      // All users query - group by status
      if (!records.length) {
        return `No ${
          filter || "attendance"
        } records found for ${queryDate.toDateString()}.`;
      }

      // Group users by status
      const groupedRecords = {
        date: queryDate.toDateString(),
        leave: records
          .filter((r) => r.is_onleave)
          .map((r) => ({ user_id: r.user_id, user: r.user, reason: r.reason })),
        wfh: records
          .filter((r) => r.is_working_from_home)
          .map((r) => ({ user_id: r.user_id, user: r.user })),
        late: records
          .filter((r) => r.is_running_late)
          .map((r) => ({ user_id: r.user_id, user: r.user })),
        early: records
          .filter((r) => r.is_leaving_early)
          .map((r) => ({ user_id: r.user_id, user: r.user })),
      };

      return groupedRecords;
    }
  } catch (error) {
    console.error("❌ Error fetching attendance records:", error);
    return "❌ Failed to fetch attendance records.";
  }
}

// ✅ Corrected Tool Definition using DynamicStructuredTool
const getAttendanceTool = new DynamicStructuredTool({
  name: "getAttendance",
  description:
    "Retrieve attendance records (leave, WFH, late arrivals, early departures) for a specific date. Can get records for a specific user or all users.",

  schema: z.object({
    user_id: z
      .string()
      .optional()
      .describe(
        "The Slack user ID of the person. If not provided, returns records for all users."
      ),
    filter: z
      .enum(["leave", "wfh", "late", "early", "all", "early"])
      .optional()
      .default("all")
      .describe(
        "Filter type: 'leave' for leaves, 'wfh' for work from home, 'late' for late arrivals, 'early' for leaving early, 'all' for everything"
      ),
    date: z
      .string()
      .optional()
      .describe(
        "Date in YYYY-MM-DD format. Defaults to today if not provided."
      ),
  }),

  func: async ({ user_id, filter, date }) => {
    console.log("🔵 Received input:", { user_id, filter, date }); // Debugging log
    return await getAttendanceRecords({ user_id, filter, date });
  },
});

// Function to generate attendance trends over time
async function getAttendanceTrends({ period = "month", type, channel_id }) {
  try {
    // Calculate date range based on period
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // MongoDB months are 1-12
    const currentYear = now.getFullYear();

    // Build the match stage for attendance type
    let matchStage = {};

    if (type === "leave") {
      matchStage.is_onleave = true;
    } else if (type === "wfh") {
      matchStage.is_working_from_home = true;
    } else if (type === "late") {
      matchStage.is_running_late = true;
    } else if (type === "early") {
      matchStage.is_leaving_early = true;
    } else {
      // If no specific type, match any attendance event
      matchStage.$or = [
        { is_onleave: true },
        { is_working_from_home: true },
        { is_running_late: true },
        { is_leaving_early: true },
      ];
    }

    // First, let's check if timestamp is a string or a Date object
    const sampleRecord = await Message.findOne(matchStage);
    console.log(
      "Sample record timestamp type:",
      typeof sampleRecord?.timestamp
    );
    console.log("Sample record timestamp:", sampleRecord?.timestamp);

    // Create date operators for aggregation
    let dateMatchStage = {};
    let periodDescription = "";

    if (period === "month") {
      // For current month of current year
      periodDescription = `${now.toLocaleString("default", {
        month: "long",
      })} ${currentYear}`;

      // Convert timestamp to date if it's a string
      dateMatchStage = {
        $addFields: {
          timestampDate: {
            $cond: {
              if: { $eq: [{ $type: "$timestamp" }, "string"] },
              then: { $dateFromString: { dateString: "$timestamp" } },
              else: "$timestamp",
            },
          },
        },
      };

      // Match records from the current month AND current year
      matchStage.$expr = {
        $and: [
          { $eq: [{ $month: "$timestampDate" }, currentMonth] },
          { $eq: [{ $year: "$timestampDate" }, currentYear] },
        ],
      };
    } else if (period === "week") {
      // For last 7 days of current year
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      periodDescription = `last 7 days (${
        sevenDaysAgo.toISOString().split("T")[0]
      } to ${now.toISOString().split("T")[0]})`;

      // Convert timestamp to date if it's a string
      dateMatchStage = {
        $addFields: {
          timestampDate: {
            $cond: {
              if: { $eq: [{ $type: "$timestamp" }, "string"] },
              then: { $dateFromString: { dateString: "$timestamp" } },
              else: "$timestamp",
            },
          },
        },
      };

      // Match records from the last 7 days of current year
      matchStage.$expr = {
        $and: [
          { $eq: [{ $year: "$timestampDate" }, currentYear] },
          {
            $gte: [
              { $dayOfYear: "$timestampDate" },
              { $dayOfYear: sevenDaysAgo },
            ],
          },
          { $lte: [{ $dayOfYear: "$timestampDate" }, { $dayOfYear: now }] },
        ],
      };
    } else if (period === "quarter") {
      // Current quarter of current year
      const currentQuarter = Math.floor((currentMonth - 1) / 3) + 1;
      const quarterStartMonth = (currentQuarter - 1) * 3 + 1;
      const quarterEndMonth = quarterStartMonth + 2;
      periodDescription = `Q${currentQuarter} ${currentYear}`;

      // Convert timestamp to date if it's a string
      dateMatchStage = {
        $addFields: {
          timestampDate: {
            $cond: {
              if: { $eq: [{ $type: "$timestamp" }, "string"] },
              then: { $dateFromString: { dateString: "$timestamp" } },
              else: "$timestamp",
            },
          },
        },
      };

      // Match records from the current quarter of current year
      matchStage.$expr = {
        $and: [
          { $eq: [{ $year: "$timestampDate" }, currentYear] },
          { $gte: [{ $month: "$timestampDate" }, quarterStartMonth] },
          { $lte: [{ $month: "$timestampDate" }, quarterEndMonth] },
        ],
      };
    }

    console.log("Match stage:", JSON.stringify(matchStage));

    // Build the aggregation pipeline
    const pipeline = [
      dateMatchStage,
      { $match: matchStage },
      {
        $group: {
          _id: {
            date: {
              $dateToString: { format: "%Y-%m-%d", date: "$timestampDate" },
            },
            category: {
              $cond: [
                { $eq: ["$is_onleave", true] },
                "leave",
                {
                  $cond: [
                    { $eq: ["$is_working_from_home", true] },
                    "wfh",
                    {
                      $cond: [
                        { $eq: ["$is_running_late", true] },
                        "late",
                        {
                          $cond: [
                            { $eq: ["$is_leaving_early", true] },
                            "early",
                            "unknown",
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.date": 1 } },
      {
        $project: {
          _id: 0,
          date: "$_id.date",
          category: "$_id.category",
          count: 1,
        },
      },
    ];

    console.log("Aggregation pipeline:", JSON.stringify(pipeline));

    // Execute the aggregation
    const trends = await Message.aggregate(pipeline);

    console.log("trends", JSON.stringify(trends, null, 2));
    console.log(`Found ${trends.length} trend data points`);

    // generateCSV
    const csvDataFormat = (record) => {
      return {
        Date: record.date,
        Category: record.category,
        Count: record.count,
      };
    };

    await generateAndSendAttendanceCSV(trends, csvDataFormat, channel_id);

    return {
      period: periodDescription,
      type: type || "all",
      data: trends,
      summary: `${type || "All"} attendance trends for ${periodDescription}`,
      recordCount: trends.length,
    };
  } catch (error) {
    console.error("❌ Error generating attendance trends:", error);
    console.error("Error details:", error.stack);
    return "❌ Failed to generate attendance trends.";
  }
}

// Function to get team member insights
async function getTeamInsights({ channel_id }) {
  try {
    // Get current month
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // MongoDB months are 1-12

    // Aggregation pipeline for team insights
    const pipeline = [
      {
        $addFields: {
          timestampDate: {
            $cond: {
              if: { $eq: [{ $type: "$timestamp" }, "string"] },
              then: { $dateFromString: { dateString: "$timestamp" } },
              else: "$timestamp",
            },
          },
        },
      },
      {
        $match: {
          $expr: {
            $eq: [{ $month: "$timestampDate" }, currentMonth],
          },
          $or: [
            { is_onleave: true },
            { is_working_from_home: true },
            { is_running_late: true },
            { is_leaving_early: true },
          ],
        },
      },
      {
        $group: {
          _id: "$user_id",
          userName: { $first: "$user" },
          original_text: { $first: "$original_text" },
          totalEvents: { $sum: 1 },
          leaveCount: {
            $sum: { $cond: [{ $eq: ["$is_onleave", true] }, 1, 0] },
          },
          wfhCount: {
            $sum: { $cond: [{ $eq: ["$is_working_from_home", true] }, 1, 0] },
          },
          lateCount: {
            $sum: { $cond: [{ $eq: ["$is_running_late", true] }, 1, 0] },
          },
          earlyCount: {
            $sum: { $cond: [{ $eq: ["$is_leaving_early", true] }, 1, 0] },
          },
        },
      },
      { $sort: { totalEvents: -1 } },
      {
        $project: {
          _id: 0,
          user_id: "$_id",
          original_text: 1,
          userName: 1,
          totalEvents: 1,
          leaveCount: 1,
          wfhCount: 1,
          lateCount: 1,
          earlyCount: 1,
        },
      },
    ];

    const userStats = await Message.aggregate(pipeline);

    // generate CSV
    const csvDataFormat = (record) => {
      return {
        user_id: record.user_id,
        userName: record.userName,
        totalEvents: record.totalEvents,
        leaveCount: record.leaveCount,
        wfhCount: record.wfhCount,
        lateCount: record.lateCount,
        earlyCount: record.earlyCount,
      };
    };

    await generateAndSendAttendanceCSV(userStats, csvDataFormat, channel_id);

    // Calculate team-wide statistics
    const teamStats = {
      month: `${now.toLocaleString("default", {
        month: "long",
      })} ${now.getFullYear()}`,
      totalEvents: userStats.reduce((sum, user) => sum + user.totalEvents, 0),
      totalLeaves: userStats.reduce((sum, user) => sum + user.leaveCount, 0),
      totalWFH: userStats.reduce((sum, user) => sum + user.wfhCount, 0),
      totalLate: userStats.reduce((sum, user) => sum + user.lateCount, 0),
      totalEarly: userStats.reduce((sum, user) => sum + user.earlyCount, 0),
      userInsights: userStats,
    };

    return teamStats;
  } catch (error) {
    console.error("❌ Error generating team insights:", error);
    console.error("Error details:", error.stack);
    return "❌ Failed to generate team insights.";
  }
}

// Function to predict attendance patterns
async function predictAttendance({ user_id, date }) {
  try {
    if (!user_id) return "User ID is required.";

    // If no specific date provided, predict for next week
    const targetDate = date ? new Date(date) : new Date();
    if (!date) {
      targetDate.setDate(targetDate.getDate() + 7); // Default to next week
    }

    const dayOfWeek = targetDate.getDay();
    const monthDay = targetDate.getDate();

    // Aggregation pipeline to analyze historical patterns
    const pipeline = [
      {
        $addFields: {
          timestampDate: {
            $cond: {
              if: { $eq: [{ $type: "$timestamp" }, "string"] },
              then: { $dateFromString: { dateString: "$timestamp" } },
              else: "$timestamp",
            },
          },
        },
      },
      {
        $match: {
          user_id,
          $or: [
            { is_onleave: true },
            { is_working_from_home: true },
            { is_running_late: true },
          ],
        },
      },
      {
        $project: {
          _id: 0,
          dayOfWeek: { $dayOfWeek: "$timestampDate" }, // 1 (Sunday) to 7 (Saturday)
          dayOfMonth: { $dayOfMonth: "$timestampDate" },
          is_onleave: 1,
          is_working_from_home: 1,
          is_running_late: 1,
        },
      },
    ];

    const historicalData = await Message.aggregate(pipeline);

    // Filter to matching day of week (MongoDB dayOfWeek is 1-7, JS is 0-6)
    const sameWeekdayEvents = historicalData.filter(
      (event) => event.dayOfWeek === dayOfWeek + 1
    );

    // Calculate probabilities
    const totalSameWeekday = sameWeekdayEvents.length;
    const leaveCount = sameWeekdayEvents.filter((e) => e.is_onleave).length;
    const wfhCount = sameWeekdayEvents.filter(
      (e) => e.is_working_from_home
    ).length;
    const lateCount = sameWeekdayEvents.filter((e) => e.is_running_late).length;

    // Check for month patterns (like first Monday of month, etc.)
    const isStartOfMonth = monthDay <= 7;
    const isEndOfMonth = monthDay >= 25;

    // Generate prediction
    let prediction = {
      user_id,
      date: targetDate.toDateString(),
      dayOfWeek: [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ][dayOfWeek],
      probabilities: {
        leave: totalSameWeekday ? (leaveCount / totalSameWeekday) * 100 : 0,
        wfh: totalSameWeekday ? (wfhCount / totalSameWeekday) * 100 : 0,
        late: totalSameWeekday ? (lateCount / totalSameWeekday) * 100 : 0,
      },
      confidence:
        totalSameWeekday > 5 ? "High" : totalSameWeekday > 2 ? "Medium" : "Low",
      insights: [],
    };

    // Add special insights
    if (isStartOfMonth && leaveCount > 0) {
      prediction.insights.push(
        "User tends to take leave at the start of the month"
      );
    }
    if (isEndOfMonth && wfhCount > 0) {
      prediction.insights.push(
        "User tends to work from home at the end of the month"
      );
    }
    if (dayOfWeek === 1 && lateCount > 0) {
      prediction.insights.push("User tends to arrive late on Mondays");
    }

    return prediction;
  } catch (error) {
    console.error("❌ Error predicting attendance:", error);
    console.error("Error details:", error.stack);
    return "❌ Failed to predict attendance patterns.";
  }
}

// Function to get team calendar view
async function getTeamCalendar({ month, year }) {
  try {
    // Default to current month and year if not provided
    const targetMonth = month ? parseInt(month) : new Date().getMonth() + 1; // MongoDB months are 1-12
    const targetYear = year ? parseInt(year) : new Date().getFullYear();

    // Aggregation pipeline for calendar view
    const pipeline = [
      {
        $addFields: {
          timestampDate: {
            $cond: {
              if: { $eq: [{ $type: "$timestamp" }, "string"] },
              then: { $dateFromString: { dateString: "$timestamp" } },
              else: "$timestamp",
            },
          },
        },
      },
      {
        $match: {
          $expr: {
            $and: [
              { $eq: [{ $month: "$timestampDate" }, targetMonth] },
              { $eq: [{ $year: "$timestampDate" }, targetYear] },
            ],
          },
          $or: [{ is_onleave: true }, { is_working_from_home: true }],
        },
      },
      {
        $project: {
          _id: 0,
          user_id: 1,
          user: 1,
          date: {
            $dateToString: { format: "%Y-%m-%d", date: "$timestampDate" },
          },
          is_onleave: 1,
          is_working_from_home: 1,
          reason: 1,
        },
      },
      { $sort: { date: 1 } },
    ];

    const records = await Message.aggregate(pipeline);

    // Group by date
    const calendarData = {};

    // Get days in month
    const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();

    // Initialize calendar structure
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${targetYear}-${targetMonth
        .toString()
        .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
      calendarData[dateStr] = {
        date: dateStr,
        onLeave: [],
        wfh: [],
      };
    }

    // Populate calendar with attendance data
    records.forEach((record) => {
      if (record.is_onleave) {
        calendarData[record.date].onLeave.push({
          user_id: record.user_id,
          user: record.user,
          reason: record.reason || "No reason provided",
        });
      }

      if (record.is_working_from_home) {
        calendarData[record.date].wfh.push({
          user_id: record.user_id,
          user: record.user,
        });
      }
    });

    return {
      month: targetMonth,
      year: targetYear,
      monthName: new Date(targetYear, targetMonth - 1, 1).toLocaleString(
        "default",
        { month: "long" }
      ),
      daysInMonth,
      calendar: Object.values(calendarData),
    };
  } catch (error) {
    console.error("❌ Error generating team calendar:", error);
    console.error("Error details:", error.stack);
    return "❌ Failed to generate team calendar.";
  }
}

// Attendance Trends Tool
const getAttendanceTrendsTool = new DynamicStructuredTool({
  name: "getAttendanceTrends",
  description:
    "Analyze attendance trends over time. Shows patterns of leaves, WFH, or late arrivals.",
  schema: z.object({
    period: z
      .enum(["week", "month", "quarter"])
      .optional()
      .default("month")
      .describe("Time period to analyze: week, month, or quarter"),
    type: z
      .enum(["leave", "wfh", "late", "all", "early"])
      .optional()
      .describe(
        "Type of attendance to analyze: leave, wfh, late, or all types if not specified"
      ),
    channel_id: z.string().optional().describe("Channel ID to send data"),
  }),
  func: async ({ period, type, channel_id }) => {
    console.log(
      "📊 Analyzing attendance trends for period:",
      period,
      "type:",
      type,
      channel_id
    );
    return await getAttendanceTrends({ period, type, channel_id });
  },
});

// Team Insights Tool
const getTeamInsightsTool = new DynamicStructuredTool({
  name: "getTeamInsights",
  description:
    "Get comprehensive insights about team attendance patterns for the current month.",
  schema: z.object({
    channel_id: z.string().optional().describe("Channel ID to send data"),
  }), // No parameters needed
  func: async ({ channel_id }) => {
    console.log("🔍 Generating team insights", channel_id);
    return await getTeamInsights({ channel_id });
  },
});

// Attendance Prediction Tool
const predictAttendanceTool = new DynamicStructuredTool({
  name: "predictAttendance",
  description:
    "Predict attendance patterns for a specific user based on historical data.",
  schema: z.object({
    user_id: z.string().describe("The Slack user ID of the person"),
    date: z
      .string()
      .optional()
      .describe(
        "Target date in YYYY-MM-DD format. Defaults to next week if not provided."
      ),
  }),
  func: async ({ user_id, date }) => {
    console.log("🔮 Predicting attendance for user:", user_id, "date:", date);
    return await predictAttendance({ user_id, date });
  },
});

// Team Calendar Tool
const getTeamCalendarTool = new DynamicStructuredTool({
  name: "getTeamCalendar",
  description:
    "Generate a calendar view of team attendance for a specific month.",
  schema: z.object({
    month: z
      .string()
      .optional()
      .describe("Month number (1-12). Defaults to current month."),
    year: z
      .string()
      .optional()
      .describe("Year (e.g., 2023). Defaults to current year."),
  }),
  func: async ({ month, year }) => {
    console.log("📅 Generating team calendar for:", month, year);
    return await getTeamCalendar({ month, year });
  },
});

export {
  getAttendanceTool,
  getAttendanceTrendsTool,
  getTeamInsightsTool,
  predictAttendanceTool,
  getTeamCalendarTool,
};
