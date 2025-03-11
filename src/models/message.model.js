const mongoose = require("mongoose");
const { z } = require("zod");

const leaveSchema = z.object({
  user: z.string().trim().toLowerCase(),
  original_text: z.string().trim(),
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
  reason: z.string().trim(),
  is_working_from_home: z.boolean().default(false),
  is_onleave: z.boolean().default(false),
  is_running_late: z.boolean().default(false),
  is_out_of_office: z.boolean().default(false),
  is_on_half_day: z.boolean().default(false),
  timestamp: z.string().datetime(),
});

const messageSchema = new mongoose.Schema(
  {
    user: { type: String, required: true, trim: true, lowercase: true },
    original_text: { type: String, required: true, trim: true },
    start_time: { type: Date },
    end_time: { type: Date },
    reason: { type: String, trim: true },
    is_working_from_home: { type: Boolean, default: false },
    is_onleave: { type: Boolean, default: false },
    is_running_late: { type: Boolean, default: false },
    is_out_of_office: { type: Boolean, default: false },
    timestamp: { type: String, required: true }, // ✅ Added message timestamp
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

module.exports = {
  leaveSchema,
  Message: mongoose.model("Message", messageSchema),
};
