# ❓ Why Are My Credentials Not Working?

## The Problem

You're seeing these warnings:
```
⚠️  Discord OAuth credentials not found
⚠️  DISCORD_BOT_TOKEN not set
```

This is **NORMAL** right now - you haven't added environment variables to Railway yet!

---

## ✅ The Solution

Railway doesn't use `.env` files - it uses **Environment Variables** that you add in the dashboard.

Your credentials ARE safe (they're in your local `.env` file), but Railway needs them as **Environment Variables**.

---

## 🔧 How to Fix

### Step 1: Get Your Credentials from Local .env

Open your local `.env` file and copy these values:

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_BOT_TOKEN`
- `GUILD_ID`
- `MIDDLEMAN_CHANNEL_ID`
- `MIDDLEMAN_ROLE_ID`
- `MODERATOR_ROLE_ID`
- `CASINO_CHANNEL_ID`
- `SESSION_SECRET`

### Step 2: Add Them to Railway

1. Go to Railway Dashboard → Your Service → **Variables** tab
2. Click **"+ New Variable"** for each one
3. Copy values from your local `.env` file

### Step 3: Get Your Railway URL

1. Railway Dashboard → Your Service
2. Look for your public URL (or check Settings → Domains)
3. It will be like: `https://zrx-market-production-xxxx.up.railway.app`

### Step 4: Update These Variables

Use your Railway URL for:
- `BASE_URL` = `https://YOUR-RAILWAY-URL.railway.app`
- `DISCORD_REDIRECT_URI` = `https://YOUR-RAILWAY-URL.railway.app/auth/discord/callback`

### Step 5: Update Discord Redirect

1. Go to Discord Developer Portal
2. OAuth2 → Redirects
3. Add: `https://YOUR-RAILWAY-URL.railway.app/auth/discord/callback`

---

## 📋 Quick Checklist

- [ ] Opened my local `.env` file
- [ ] Copied all the values
- [ ] Went to Railway → Variables tab
- [ ] Added each variable one by one
- [ ] Got my Railway URL
- [ ] Updated BASE_URL with Railway URL
- [ ] Updated DISCORD_REDIRECT_URI with Railway URL
- [ ] Added redirect URI in Discord Developer Portal

---

## 🎯 After Adding Variables

Railway will automatically redeploy, and the warnings will disappear!

---

**Your credentials are safe - just need to add them to Railway as Environment Variables!** 🔒

