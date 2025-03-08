const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  user: String,
  text: String,
  ts: String,
  channel: String,
});

module.exports = mongoose.model("Message", messageSchema);
