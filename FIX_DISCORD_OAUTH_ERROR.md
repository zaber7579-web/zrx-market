# Fix: "Invalid OAuth2 redirect_uri" Error

## The Problem
Discord is rejecting the OAuth request because the redirect URI doesn't match what's registered in your Discord Developer Portal.

## Quick Fix (2 Steps)

### Step 1: Update Discord Developer Portal

1. **Go to Discord Developer Portal:**
   - Visit: https://discord.com/developers/applications
   - Select your application

2. **Go to OAuth2 → Redirects:**
   - Click **"OAuth2"** in the left sidebar
   - Scroll down to **"Redirects"** section

3. **Add/Update Redirect URI:**
   - Click **"Add Redirect"** or edit existing one
   - Add: `https://zrxmarket.com/auth/discord/callback`
   - If you're using www: `https://www.zrxmarket.com/auth/discord/callback`
   - **Important:** The URL must match EXACTLY (including https://, no trailing slash)

4. **Remove Old Redirects (if any):**
   - Remove any old Railway URLs like `https://your-app.up.railway.app/auth/discord/callback`
   - Remove localhost URLs if you're in production

5. **Click "Save Changes"**

### Step 2: Update Railway Environment Variable

1. **Go to Railway Dashboard:**
   - Visit: https://railway.app
   - Select your project → Your service

2. **Go to Variables Tab:**
   - Click **"Variables"** tab

3. **Update/Create DISCORD_REDIRECT_URI:**
   - Find or create: `DISCORD_REDIRECT_URI`
   - Set value to: `https://zrxmarket.com/auth/discord/callback`
   - **Important:** Must match EXACTLY what you added in Discord (including https://)

4. **Verify Other Variables:**
   - `BASE_URL=https://zrxmarket.com`
   - `FRONTEND_URL=https://zrxmarket.com`
   - `NODE_ENV=production`

5. **Redeploy:**
   - Go to **"Deployments"** tab
   - Click **"Redeploy"** to apply the new environment variable

## Common Mistakes to Avoid

❌ **Wrong:**
- `http://zrxmarket.com/auth/discord/callback` (missing 's' in https)
- `https://zrxmarket.com/auth/discord/callback/` (trailing slash)
- `https://www.zrxmarket.com/auth/discord/callback` (if you didn't add www in Discord)

✅ **Correct:**
- `https://zrxmarket.com/auth/discord/callback` (exact match)

## Verify It's Fixed

1. **Wait 1-2 minutes** after redeploying Railway
2. **Clear your browser cache** or use incognito mode
3. **Try logging in again** at `https://zrxmarket.com`
4. The Discord authorization page should now work!

## Still Not Working?

### Check 1: Verify Environment Variable is Set
- In Railway, check that `DISCORD_REDIRECT_URI` is exactly: `https://zrxmarket.com/auth/discord/callback`
- No extra spaces, no quotes, exact match

### Check 2: Verify Discord Redirect URI
- In Discord Developer Portal, check the redirect URI is exactly: `https://zrxmarket.com/auth/discord/callback`
- Make sure you clicked "Save Changes"

### Check 3: Check Railway Logs
- Go to Railway → Your service → **"Logs"** tab
- Look for any errors about Discord OAuth
- The logs should show the redirect URI being used

### Check 4: Test the URL
- Visit: `https://zrxmarket.com/auth/discord`
- This should redirect to Discord
- If you see the error, the redirect URI still doesn't match

## Need Both www and non-www?

If you want both `zrxmarket.com` and `www.zrxmarket.com` to work:

1. **In Discord Developer Portal:**
   - Add BOTH redirect URIs:
     - `https://zrxmarket.com/auth/discord/callback`
     - `https://www.zrxmarket.com/auth/discord/callback`

2. **In Railway:**
   - Set `DISCORD_REDIRECT_URI` to your primary domain (usually non-www)
   - Or use the one that matches your `BASE_URL`

## Summary Checklist

- [ ] Added `https://zrxmarket.com/auth/discord/callback` in Discord Developer Portal
- [ ] Clicked "Save Changes" in Discord Developer Portal
- [ ] Set `DISCORD_REDIRECT_URI=https://zrxmarket.com/auth/discord/callback` in Railway
- [ ] Redeployed Railway service
- [ ] Waited 1-2 minutes
- [ ] Cleared browser cache
- [ ] Tested login again





