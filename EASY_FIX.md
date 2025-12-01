# ⚡ Easy Fix - 3 Steps

## Why You See Warnings

Railway doesn't have your environment variables yet. You need to add them!

---

## Step 1: Open Your Local .env File (1 minute)

1. Open the file: `zrx-market/.env` (in your project root)
2. You'll see all your credentials there

---

## Step 2: Get Your Railway URL (30 seconds)

1. Go to: https://railway.app
2. Click your project → Click "zrx-market" service
3. Look at the top - there's your URL!
   - Example: `https://zrx-market-production-xxxx.up.railway.app`

---

## Step 3: Add Variables to Railway (5 minutes)

1. **Railway Dashboard** → Your Service → **Variables** tab
2. Click **"+ New Variable"**
3. Add each one from this list:

### Copy from your .env file:

| Railway Variable Name | Value (from your .env) |
|----------------------|------------------------|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | (copy from .env) |
| `DISCORD_CLIENT_ID` | (copy from .env) |
| `DISCORD_CLIENT_SECRET` | (copy from .env) |
| `DISCORD_BOT_TOKEN` | (copy from .env) |
| `GUILD_ID` | (copy from .env) |
| `MIDDLEMAN_CHANNEL_ID` | (copy from .env) |
| `MIDDLEMAN_ROLE_ID` | (copy from .env) |
| `MODERATOR_ROLE_ID` | (copy from .env) |
| `CASINO_CHANNEL_ID` | (copy from .env) |
| `BASE_URL` | `https://YOUR-RAILWAY-URL.railway.app` |
| `DISCORD_REDIRECT_URI` | `https://YOUR-RAILWAY-URL.railway.app/auth/discord/callback` |

**Replace `YOUR-RAILWAY-URL` with your actual Railway URL from Step 2!**

---

## Step 4: Update Discord (1 minute)

1. Go to: https://discord.com/developers/applications
2. Your Application → **OAuth2** → **Redirects**
3. Add: `https://YOUR-RAILWAY-URL.railway.app/auth/discord/callback`
4. Save

---

## ✅ Done!

Railway will auto-redeploy. Wait 1 minute, then:
- Warnings will be gone ✅
- Your website will be at: `https://YOUR-RAILWAY-URL.railway.app` 🔗

---

**That's it! Your website link is your Railway URL!** 🎉

