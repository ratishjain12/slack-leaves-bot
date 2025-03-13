import { z } from "zod";
import mongoose from "mongoose";

export const leaveSchema = z.object({
  user_id: z.string().trim().toLowerCase(),
  user: z.string().trim().toLowerCase(),
  original_text: z.string().trim(),
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
  reason: z.string().trim(),
  leave_day: z.string().datetime().optional(),
  is_working_from_home: z.boolean().default(false),
  is_onleave: z.boolean().default(false),
  is_leaving_early: z.boolean().default(false),
  is_running_late: z.boolean().default(false),
  is_out_of_office: z.boolean().default(false),
  is_on_half_day: z.boolean().default(false),
  timestamp: z.string().datetime(),
});

const messageSchema = new mongoose.Schema(
  {
    user_id: { type: String, required: true, trim: true, lowercase: true },
    user: { type: String, required: true, trim: true, lowercase: true },
    original_text: { type: String, required: true, trim: true },
    start_time: { type: Date },
    end_time: { type: Date },
    reason: { type: String, trim: true },
    leave_day: { type: Date },
    is_working_from_home: { type: Boolean, default: false },
    is_onleave: { type: Boolean, default: false },
    is_leaving_early: { type: Boolean, default: false },
    is_running_late: { type: Boolean, default: false },
    is_out_of_office: { type: Boolean, default: false },
    is_on_half_day: { type: Boolean, default: false },
    timestamp: { type: String, required: true }, // ✅ Added message timestamp
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

export const Message = mongoose.model("Message", messageSchema);
