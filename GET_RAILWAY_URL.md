# 🔗 How to Get Your Railway Website URL

## Step 1: Find Your Railway URL

1. **Go to Railway Dashboard**
   - Open: https://railway.app
   - Click your project (probably "vivacious-dream")

2. **Click Your Service**
   - Click on "zrx-market" service

3. **Find Your URL**
   - Look at the top of the page - there should be a URL shown
   - OR go to **"Settings"** tab → Look for **"Domains"** section
   - OR go to **"Deployments"** tab → Click on a deployment → Look for the URL

Your URL will look like:
```
https://zrx-market-production-xxxx.up.railway.app
```

**This is your website URL!** 🎉

---

## Step 2: Copy Your URL

Copy that URL - you'll need it for:
- Testing your API
- Adding to Discord OAuth redirects
- Setting BASE_URL environment variable

---

## Step 3: Test Your Server

Once you have the URL, test it:

1. **Health Check:**
   ```
   https://YOUR-URL.railway.app/health
   ```
   Should return: `{"status":"ok"}`

2. **API Root:**
   ```
   https://YOUR-URL.railway.app/
   ```
   Should return API information

---

## 📍 Quick Ways to Find URL:

### Method 1: Service Overview
- Railway Dashboard → Your Service
- URL is usually shown at the top

### Method 2: Settings Tab
- Railway Dashboard → Your Service → **Settings**
- Look for **"Domains"** or **"Custom Domain"** section

### Method 3: Deployments
- Railway Dashboard → Your Service → **Deployments**
- Click on a deployment
- URL might be shown in the details

### Method 4: Network Tab
- Railway Dashboard → Your Service → **Settings**
- Look for **"Network"** section
- Your public URL should be listed

---

**Your Railway URL is your website link!** 🔗

