# ✅ Setup Checklist - Check Off As You Go

## 📋 Railway Setup

- [ ] Found my Railway URL: `https://________________.railway.app`
- [ ] Opened Railway Dashboard
- [ ] Went to my service: "zrx-market"
- [ ] Opened "Variables" tab

## 🔐 Discord Setup

- [ ] Opened Discord Developer Portal: https://discord.com/developers/applications
- [ ] Selected my application
- [ ] Got Client ID from OAuth2 tab
- [ ] Got Client Secret from OAuth2 tab (reset if needed)
- [ ] Added Redirect URI: `https://MY-URL.railway.app/auth/discord/callback`
- [ ] Got Bot Token from Bot tab (reset if needed)
- [ ] Enabled Message Content Intent
- [ ] Enabled Developer Mode in Discord
- [ ] Got Guild ID (Server ID)
- [ ] Got Middleman Channel ID
- [ ] Got Middleman Role ID
- [ ] Got Moderator Role ID
- [ ] Got Casino Channel ID (if applicable)

## 🔑 Generate Secret

- [ ] Generated SESSION_SECRET (32+ characters)
  - Used: https://generate-secret.vercel.app/32
  - OR: `openssl rand -base64 32`

## 📝 Add Variables to Railway

- [ ] Added `NODE_ENV` = `production`
- [ ] Added `SESSION_SECRET` = (my generated secret)
- [ ] Added `DISCORD_CLIENT_ID` = (my client ID)
- [ ] Added `DISCORD_CLIENT_SECRET` = (my client secret)
- [ ] Added `DISCORD_BOT_TOKEN` = (my bot token)
- [ ] Added `DISCORD_REDIRECT_URI` = `https://MY-URL.railway.app/auth/discord/callback`
- [ ] Added `GUILD_ID` = (my server ID)
- [ ] Added `MIDDLEMAN_CHANNEL_ID` = (my channel ID)
- [ ] Added `MIDDLEMAN_ROLE_ID` = (my role ID)
- [ ] Added `MODERATOR_ROLE_ID` = (my role ID)
- [ ] Added `CASINO_CHANNEL_ID` = (my channel ID)
- [ ] Added `BASE_URL` = `https://MY-URL.railway.app`

## ✅ Verification

- [ ] Railway auto-redeployed (or I clicked Redeploy)
- [ ] Checked logs - no warnings!
- [ ] Tested health endpoint: `/health` returns `{"status":"ok"}`
- [ ] Server is running successfully!

---

## 🎉 All Done!

When all boxes are checked, your backend is fully configured! 🚀

