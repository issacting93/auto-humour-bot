# Slack App Setup

Slack apps are manifest-based. Use one of these approaches.

---

## Create a new app from the manifest (recommended)

1. Go to **https://api.slack.com/apps** → **Create New App** → **From an app manifest**.
2. Choose your workspace → **Next**.
3. Choose **JSON** and paste the contents of **`bot/slack-app-manifest.json`**.
4. **Next** → **Create**.
5. **Install to Workspace**.
6. Copy **Bot User OAuth Token** (OAuth & Permissions) and **Signing Secret** (Basic Information) into `bot/.env`.
7. Under **Slash Commands** → **/meme**, set **Request URL** to your bot's URL (e.g. `https://your-ngrok-url/slack/events`).

This creates the app with bot user, `/meme` command, and scopes in one go.

---

## Fix "no bot user" on an existing app

1. Go to **https://api.slack.com/apps** and open your app.
2. Click **App Manifest** in the left sidebar.
3. Ensure the manifest has a `features` block with `bot_user`:
   ```json
   "features": {
     "bot_user": {
       "display_name": "HumourBot",
       "always_online": true
     }
   }
   ```
   If you already have `features` (e.g. `slash_commands`), add `bot_user` inside the same object.
4. Click **Save**.
5. Go to **Install App** and install/reinstall.

---

## Legacy "Bot Users" sidebar item

Some workspaces still show the legacy **Bot Users** item:

1. Click **Bot Users** → **Add Legacy Bot User** (or **Add a Bot User**).
2. Set display name and default username → **Add** → **Save Changes**.
3. **Install App** (or Reinstall).

Slack is deprecating legacy custom bots. Prefer creating a new app from the manifest instead.
