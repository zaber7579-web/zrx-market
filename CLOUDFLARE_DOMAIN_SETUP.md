# Cloudflare Domain Setup Guide for zrxmarket.com

## Step 1: Get Your Railway Domain

1. Go to your Railway project dashboard
2. Click on your service
3. Go to the **Settings** tab
4. Scroll down to **Domains** section
5. Click **Generate Domain** if you haven't already
6. Copy your Railway domain (e.g., `your-app.up.railway.app`)

## Step 2: Configure DNS in Cloudflare

1. **Log into Cloudflare Dashboard**
   - Go to https://dash.cloudflare.com
   - Select your domain: **zrxmarket.com**

2. **Add CNAME Record for www Subdomain**
   - Click **DNS** → **Records**
   - Click **Add record**
   - Type: `CNAME`
   - Name: `www`
   - Target: `your-app.up.railway.app` (your Railway domain)
   - Proxy status: **Proxied** (orange cloud) ✅
   - Click **Save**

3. **Add CNAME Record for Root Domain (@)**
   - Click **Add record** again
   - Type: `CNAME`
   - Name: `@` (for root domain zrxmarket.com)
   - Target: `your-app.up.railway.app`
   - Proxy status: **Proxied** (orange cloud) ✅
   - Click **Save**

   **Note:** Some registrars don't allow CNAME on root. If that's the case:
   - Use **A record** instead:
     - Type: `A`
     - Name: `@`
     - IPv4 address: Get this from Railway (they'll provide an IP)
     - Proxy status: **Proxied** ✅

## Step 3: Configure Domain in Railway

1. **In Railway Dashboard:**
   - Go to your service → **Settings** → **Domains**
   - Click **Custom Domain**
   - Enter your domain: `zrxmarket.com`
   - Click **Add**
   - Railway will verify the DNS records (may take a few minutes)
   - **Also add:** `www.zrxmarket.com` (if you want www to work)

2. **Wait for SSL Certificate**
   - Railway automatically provisions SSL certificates
   - This usually takes 5-10 minutes
   - You'll see a green checkmark when it's ready

## Step 4: Update Environment Variables in Railway

1. **Go to Railway Dashboard** → Your Service → **Variables** tab

2. **Update these variables:**

```env
BASE_URL=https://zrxmarket.com
FRONTEND_URL=https://zrxmarket.com
NODE_ENV=production
```

3. **If you have separate frontend/backend:**
   - Backend: `BASE_URL=https://zrxmarket.com`
   - Frontend: `VITE_API_URL=https://zrxmarket.com`

## Step 5: Update Discord OAuth Redirect URI

1. **Go to Discord Developer Portal:**
   - https://discord.com/developers/applications
   - Select your application
   - Go to **OAuth2** → **Redirects**

2. **Update/Add Redirect URI:**
   - Remove old Railway URL if needed
   - Add: `https://zrxmarket.com/auth/discord/callback`
   - Add: `https://www.zrxmarket.com/auth/discord/callback` (if using www)
   - Click **Save Changes**

3. **Update Environment Variable in Railway:**
   ```env
   DISCORD_REDIRECT_URI=https://zrxmarket.com/auth/discord/callback
   ```

## Step 6: Update CORS Settings

Your backend already uses `BASE_URL` for CORS and has been updated to support both www and non-www versions. The configuration in `backend/server.js` now allows:

- `https://zrxmarket.com`
- `https://www.zrxmarket.com`
- Your `BASE_URL` environment variable
- Your `FRONTEND_URL` environment variable

This ensures both `zrxmarket.com` and `www.zrxmarket.com` will work correctly.

## Step 7: Redeploy

1. **In Railway:**
   - Go to your service
   - Click **Deployments** → **Redeploy** (or push a new commit)
   - This ensures all environment variables are loaded

## Step 8: Test Your Domain

1. **Wait 5-10 minutes** for DNS propagation
2. **Test your domain:**
   - Visit: `https://zrxmarket.com`
   - Visit: `https://www.zrxmarket.com`
   - Both should work!

3. **Test Discord OAuth:**
   - Try logging in with Discord
   - Should redirect to your custom domain

## Troubleshooting

### DNS Not Working?
- **Check DNS propagation:** Use https://dnschecker.org
- **Verify Cloudflare settings:** Make sure proxy is enabled (orange cloud)
- **Wait longer:** DNS can take up to 24 hours (usually 5-30 minutes)

### SSL Certificate Issues?
- **Wait 10-15 minutes** after adding domain in Railway
- **Check Railway logs** for SSL errors
- **Verify DNS is correct** - Railway needs to verify ownership

### CORS Errors?
- **Check BASE_URL** environment variable in Railway
- **Clear browser cache** and cookies
- **Check browser console** for specific CORS errors

### Domain Not Resolving?
- **Check Cloudflare DNS records** are correct
- **Verify Railway domain** is correct
- **Try accessing Railway domain directly** to ensure service is running

## Cloudflare Settings (Recommended)

1. **SSL/TLS Mode:**
   - Go to **SSL/TLS** → **Overview**
   - Set to **Full** or **Full (strict)** ✅

2. **Always Use HTTPS:**
   - Go to **SSL/TLS** → **Edge Certificates**
   - Enable **Always Use HTTPS** ✅

3. **Auto Minify (Optional):**
   - Go to **Speed** → **Optimization**
   - Enable **Auto Minify** for JavaScript, CSS, HTML

4. **Caching (Optional):**
   - Go to **Caching** → **Configuration**
   - Set caching level to **Standard**

## Quick Checklist for zrxmarket.com

- [ ] Added CNAME records in Cloudflare (www and @) pointing to Railway domain
- [ ] Enabled Cloudflare proxy (orange cloud) for both records
- [ ] Added custom domain `zrxmarket.com` in Railway
- [ ] Added custom domain `www.zrxmarket.com` in Railway (optional but recommended)
- [ ] Updated `BASE_URL=https://zrxmarket.com` in Railway environment variables
- [ ] Updated `FRONTEND_URL=https://zrxmarket.com` in Railway environment variables
- [ ] Updated `DISCORD_REDIRECT_URI=https://zrxmarket.com/auth/discord/callback` in Railway
- [ ] Updated Discord OAuth redirect URI in Discord Developer Portal
- [ ] Redeployed Railway service
- [ ] Waited 10-15 minutes for DNS/SSL propagation
- [ ] Tested `https://zrxmarket.com` access
- [ ] Tested `https://www.zrxmarket.com` access (if configured)
- [ ] Tested Discord login flow

## Need Help?

If you're stuck:
1. Check Railway logs for errors
2. Check Cloudflare DNS records
3. Verify environment variables are set correctly
4. Make sure Railway service is running and healthy


