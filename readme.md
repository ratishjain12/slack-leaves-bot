# AI Slack Bot Starter

## 🚀 Overview

This is a **Slack bot starter template** built using [Slack Bolt](https://slack.dev/bolt-js/) and MongoDB. It listens for messages in Slack channels and saves them to a database for future AI integration.

## 📂 Project Structure

```
ratishjain12-slack-bot-starter/
├── package.json
├── .env.example
└── src/
    ├── app.js
    ├── index.js
    ├── config/
    │   ├── database.js
    │   └── env.js
    ├── models/
    │   └── message.model.js
    └── services/
        └── slack.service.js
```

### 📌 **Folder Descriptions**

- **`src/app.js`** → Initializes database and starts the Slack bot.
- **`src/index.js`** → Entry point for the application.
- **`src/config/database.js`** → Handles MongoDB connection.
- **`src/config/env.js`** → Loads environment variables.
- **`src/models/message.model.js`** → Defines MongoDB schema for storing Slack messages.
- **`src/services/slack.service.js`** → Handles Slack bot interactions.

## 🛠️ Installation & Setup

### 1️⃣ **Clone the Repository**

```sh
git clone https://github.com/your-username/ratishjain12-slack-bot-starter.git
cd ratishjain12-slack-bot-starter
```

### 2️⃣ **Install Dependencies**

```sh
npm install
```

### 3️⃣ **Set Up Environment Variables**

Rename `.env.example` to `.env` and update the values:

```sh
SLACK_BOT_TOKEN=your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=your-app-token
MONGO_URI=mongodb://your-mongo-db-uri
PORT=3000
```

### 4️⃣ **Run the Bot**

#### **Development Mode (with auto-reload)**

```sh
npm run dev
```

#### **Production Mode**

```sh
npm start
```

## 🔗 Slack App Setup

1. **Create a Slack App** at [Slack API Dashboard](https://api.slack.com/apps).
2. **Enable Socket Mode** under **App-Level Tokens**.
3. **Add OAuth Scopes** in `OAuth & Permissions`:
   - `channels:history`
   - `channels:read`
4. **Install the App to Your Workspace** and get the tokens.
5. **Events Subscriptions Subscribe to message.channels event**.
6. **Invite the bot to a channel** using `/invite @bot_name`.

## 📝 Features

- ✅ Reads messages from Slack channels.
- ✅ Stores messages in MongoDB.
- ✅ Uses Socket Mode for real-time message listening.


**🚀 Ready to build your Slack bot? Start coding!**
