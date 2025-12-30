# Railway Quick Start for Miss Death Bot

## 🚀 Fast Deployment Steps

### 1. Install Railway CLI
```bash
npm install -g @railway/cli
railway login
```

### 2. Deploy Bot
```bash
cd bot
railway init
railway link  # If deploying to existing project
```

### 3. Set Environment Variables in Railway Dashboard

Go to Railway → Your Project → Variables tab and add:

```env
DISCORD_BOT_TOKEN=your_bot_token_from_discord_dev_portal
GUILD_ID=your_discord_server_id
NODE_ENV=production
```

**How to get these:**
- **DISCORD_BOT_TOKEN:** Discord Developer Portal → Your App → Bot → Copy Token
- **GUILD_ID:** Right-click your Discord server → Copy Server ID
- **NODE_ENV:** Just type `production`

### 4. Configure Deploy Settings

In Railway dashboard:
- **Root Directory:** `bot`
- **Build Command:** `npm install`
- **Start Command:** `npm start`

### 5. Deploy!

```bash
railway up
```

Or just push to GitHub - Railway auto-deploys on push!

---

## 📋 Environment Variables Reference

### Required:
- `DISCORD_BOT_TOKEN` - Bot token from Discord
- `GUILD_ID` - Your Discord server ID
- `NODE_ENV=production`

### Optional (if using features):
- `CASINO_CHANNEL_ID` - Channel ID for casino commands
- `GROQ_API_KEY` - API key for AI chat features
- `MODERATOR_ROLE_ID` - Role ID for moderator commands

---

## 🔍 Check Logs

```bash
railway logs
```

Or in Railway dashboard → Deployments → Click latest → View logs

---

## ✅ Verify Bot is Online

1. Check Railway logs - should see "Bot logged in as..."
2. Check Discord - bot should show as online
3. Try `/ping` command in Discord
4. Run `/setup` to create channels

---

## 🆘 Common Issues

**Bot not starting?**
- Check logs: `railway logs`
- Verify DISCORD_BOT_TOKEN is correct
- Make sure you copied entire token (no spaces)

**Commands not showing?**
- Wait 5-10 minutes after bot starts
- Bot needs to register commands with Discord
- Try restarting bot in Railway

**Permission errors?**
- Bot needs "Manage Channels" permission
- Bot role must be above roles it manages
- Re-invite bot with correct permissions

---

## 📝 Next Steps After Deployment

1. Run `/setup` in Discord
2. Run `/welcome channel` to set welcome channel
3. Run `/welcome message` to customize message
4. Test by having someone join server!

