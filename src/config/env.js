require("dotenv").config();
module.exports = {
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
  SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
  SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN,
  MONGO_URI: process.env.MONGO_URI,
  PORT: process.env.PORT || 3000,
};
