import { WebClient } from "@slack/web-api";
import fs from "fs";
import { format } from "fast-csv";

const web = new WebClient(process.env.SLACK_BOT_TOKEN);

async function generateAttendanceCSV(data, csvDataFormat, filePath) {
  return new Promise((resolve, reject) => {
    const csvStream = format({ headers: true });
    const writableStream = fs.createWriteStream(filePath);

    writableStream.on("finish", resolve);
    writableStream.on("error", reject);

    csvStream.pipe(writableStream);

    // Add data to CSV according to the format

    data.forEach((record) => {
      csvStream.write(csvDataFormat(record));
    });

    csvStream.end();
  });
}

async function generateAndSendAttendanceCSV(data, csvDataFormat, channel_id) {
  try {
    console.log("data", data);
    if (!data || data.length === 0) {
      return "❌ No attendance data available.";
    }

    const filePath = "./public/attendance_report.csv";

    // Generate CSV
    await generateAttendanceCSV(data, csvDataFormat, filePath);

    // Upload CSV to Slack
    await web.files.uploadV2({
      channel_id: channel_id,
      file: fs.createReadStream(filePath),
      title: "Attendance Report",
      filename: "attendance_report.csv",
      filetype: "csv",
    });

    // Delete the CSV file

    fs.unlink(filePath, (err) => {
      if (err) {
        console.error("❌ Error deleting CSV file:", err);
      }
    });

    return "✅ Attendance report CSV uploaded successfully!";
  } catch (error) {
    console.error("❌ Error generating/sending CSV:", error);
    return "❌ Failed to generate attendance CSV.";
  }
}

export { generateAndSendAttendanceCSV };
