# ⚡ Quick Start - 5 Minutes

## 1. Get Railway URL (30 seconds)

Railway Dashboard → Your Service → Copy the URL at the top
Example: `https://zrx-market-production-xxxx.up.railway.app`

---

## 2. Get Discord Values (2 minutes)

Go to: https://discord.com/developers/applications

**OAuth2 Tab:**
- Copy Client ID
- Reset & Copy Client Secret
- Add Redirect: `https://YOUR-URL.railway.app/auth/discord/callback`

**Bot Tab:**
- Reset & Copy Token
- Enable Message Content Intent

**Discord App:**
- Enable Developer Mode (Settings → Advanced)
- Right-click server → Copy Server ID
- Right-click channels → Copy Channel IDs
- Right-click roles → Copy Role IDs

---

## 3. Generate Secret (10 seconds)

Go to: https://generate-secret.vercel.app/32
Copy the secret

---

## 4. Add to Railway (2 minutes)

Railway → Service → Variables → + New Variable

Add these (one by one):

| Variable Name | Value |
|--------------|-------|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | (paste generated secret) |
| `DISCORD_CLIENT_ID` | (paste client ID) |
| `DISCORD_CLIENT_SECRET` | (paste client secret) |
| `DISCORD_BOT_TOKEN` | (paste bot token) |
| `DISCORD_REDIRECT_URI` | `https://YOUR-URL.railway.app/auth/discord/callback` |
| `GUILD_ID` | (paste server ID) |
| `MIDDLEMAN_CHANNEL_ID` | (paste channel ID) |
| `MIDDLEMAN_ROLE_ID` | (paste role ID) |
| `MODERATOR_ROLE_ID` | (paste role ID) |
| `CASINO_CHANNEL_ID` | (paste channel ID) |
| `BASE_URL` | `https://YOUR-URL.railway.app` |

---

## 5. Done! ✅

Railway will auto-redeploy. Wait 1 minute, then test:
`https://YOUR-URL.railway.app/health`

Should return: `{"status":"ok"}`

---

**That's it! You're done!** 🎉

