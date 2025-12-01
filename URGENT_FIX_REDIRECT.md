# 🚨 URGENT: Fix Redirect to Localhost

## The Problem

After Discord login, it redirects to `http://localhost:5173` instead of your Railway URL.

---

## ✅ IMMEDIATE FIX: Add FRONTEND_URL to Railway

### Step 1: Add Variable in Railway

1. Go to **Railway Dashboard**
2. Click your service → **Variables** tab
3. Look for `FRONTEND_URL` - is it there?
4. If NOT, click **"+ New Variable"**:
   - **Name**: `FRONTEND_URL`
   - **Value**: `https://zrx-market-copy-production.up.railway.app`
5. Click **"Add"**

### Step 2: Verify It's Set

After adding, you should see `FRONTEND_URL` in your variables list.

### Step 3: Force Redeploy

1. Go to **Deployments** tab in Railway
2. Click **"Redeploy"** or **"Deploy Latest"**
3. Wait 1-2 minutes for deployment

---

## 🔍 Debug: Check What Railway Sees

After redeploy, check Railway logs:

1. Railway Dashboard → Your Service → **Deployments**
2. Click the latest deployment → **View Logs**
3. Look for lines like:
   - `🔍 Frontend redirect URL: ...`
   - `🔍 FRONTEND_URL env: ...`

This will show what URL is being used!

---

## ✅ Verify All Variables Are Set

Make sure ALL of these are in Railway Variables:

- ✅ `FRONTEND_URL` = `https://zrx-market-copy-production.up.railway.app`
- ✅ `BASE_URL` = `https://zrx-market-copy-production.up.railway.app`
- ✅ `DISCORD_REDIRECT_URI` = `https://zrx-market-copy-production.up.railway.app/auth/discord/callback`

---

## 🎯 After Redeploy

1. Wait 1-2 minutes for deployment to complete
2. Try Discord login again
3. It should redirect to `https://zrx-market-copy-production.up.railway.app` instead of localhost!

---

**Add `FRONTEND_URL` to Railway Variables and Redeploy!** 🚨

