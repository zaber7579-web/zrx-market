# 🚀 Complete Setup Guide - Step by Step

Follow these steps in order to complete your deployment!

---

## Step 1: Get Your Railway URL

1. Go to https://railway.app
2. Click your project
3. Click your service: **"zrx-market"**
4. Look for your **public URL** (usually shown at the top or in Settings)
   - It looks like: `https://zrx-market-production-xxxx.up.railway.app`
   - **COPY THIS URL** - you'll need it!

---

## Step 2: Get Discord Credentials

### A. Discord Client ID & Secret

1. Go to: https://discord.com/developers/applications
2. Click your application (or create one)
3. Go to **"OAuth2"** tab (left sidebar)
4. **Copy Client ID** → This is `DISCORD_CLIENT_ID`
5. Click **"Reset Secret"** → Copy the secret → This is `DISCORD_CLIENT_SECRET`
6. Under **"Redirects"**, click **"Add Redirect"**
7. Add: `https://YOUR-RAILWAY-URL.railway.app/auth/discord/callback`
   - Replace `YOUR-RAILWAY-URL` with your actual Railway URL from Step 1
8. Click **"Save Changes"**

### B. Discord Bot Token

1. Still in Discord Developer Portal → Your Application
2. Go to **"Bot"** tab (left sidebar)
3. Click **"Reset Token"** → Copy it → This is `DISCORD_BOT_TOKEN`
4. Under **"Privileged Gateway Intents"**, make sure these are enabled:
   - ✅ **Message Content Intent** (required!)
5. Click **"Save Changes"**

### C. Discord Server/Channel/Role IDs

1. Open Discord
2. Enable **Developer Mode**: 
   - User Settings → Advanced → Developer Mode ✅
3. Get IDs:
   - **Guild ID**: Right-click your Discord server name → "Copy Server ID"
   - **Channel IDs**: Right-click channel → "Copy Channel ID"
     - Get: `MIDDLEMAN_CHANNEL_ID`
     - Get: `CASINO_CHANNEL_ID` (if you have one)
   - **Role IDs**: Right-click role → "Copy Role ID"
     - Get: `MIDDLEMAN_ROLE_ID`
     - Get: `MODERATOR_ROLE_ID`

---

## Step 3: Generate SESSION_SECRET

Generate a random secret (32+ characters):

**Option A - Online:**
1. Go to: https://generate-secret.vercel.app/32
2. Copy the generated secret

**Option B - Terminal:**
```bash
openssl rand -base64 32
```

---

## Step 4: Add Variables to Railway

1. Go to Railway → Your Service → **"Variables"** tab
2. Click **"+ New Variable"** for each one below

### Copy-Paste Ready (replace YOUR-VALUES):

```
NODE_ENV
production
```

```
SESSION_SECRET
PASTE-YOUR-GENERATED-SECRET-HERE
```

```
DISCORD_CLIENT_ID
PASTE-YOUR-CLIENT-ID-HERE
```

```
DISCORD_CLIENT_SECRET
PASTE-YOUR-CLIENT-SECRET-HERE
```

```
DISCORD_BOT_TOKEN
PASTE-YOUR-BOT-TOKEN-HERE
```

```
DISCORD_REDIRECT_URI
https://YOUR-RAILWAY-URL.railway.app/auth/discord/callback
```
(Replace YOUR-RAILWAY-URL with your actual URL)

```
GUILD_ID
PASTE-YOUR-SERVER-ID-HERE
```

```
MIDDLEMAN_CHANNEL_ID
PASTE-YOUR-MIDDLEMAN-CHANNEL-ID-HERE
```

```
MIDDLEMAN_ROLE_ID
PASTE-YOUR-MIDDLEMAN-ROLE-ID-HERE
```

```
MODERATOR_ROLE_ID
PASTE-YOUR-MODERATOR-ROLE-ID-HERE
```

```
CASINO_CHANNEL_ID
PASTE-YOUR-CASINO-CHANNEL-ID-HERE
```

```
BASE_URL
https://YOUR-RAILWAY-URL.railway.app
```
(Replace YOUR-RAILWAY-URL with your actual URL)

---

## Step 5: Wait for Redeploy

After adding variables:
- Railway will automatically redeploy
- Wait 1-2 minutes
- Check logs - warnings should be gone!

---

## Step 6: Test Your Server

1. Visit: `https://YOUR-RAILWAY-URL.railway.app/health`
2. Should return: `{"status":"ok"}`

---

## ✅ Done!

Your backend is now fully configured and running!

---

## 🆘 Need Help Finding Values?

- **Railway URL**: Railway Dashboard → Service → Look at the top or Settings
- **Discord IDs**: Enable Developer Mode in Discord → Right-click → Copy ID
- **Discord Tokens**: Discord Developer Portal → Your Application

---

**Follow these steps and you're done!** 🎉

