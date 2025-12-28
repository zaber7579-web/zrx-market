# Fix: Errors After Discord Login

## The Problem
After logging in with Discord, you see the dashboard for a second, then errors appear. This is because:

1. ✅ Login works successfully
2. ✅ You get redirected to `/dashboard`
3. ❌ Dashboard tries to load trades/messages
4. ❌ Database queries fail because columns are missing (`isCrossTrade`, `isRead`)

## The Solution

The database schema has been fixed in the code, but **Railway needs to redeploy** for the migrations to run.

### Option 1: Wait for Auto-Deploy (Recommended)
If Railway is connected to GitHub:
- The changes should auto-deploy within a few minutes
- Check Railway dashboard → Deployments tab
- Wait for the new deployment to complete

### Option 2: Manual Redeploy
1. Go to Railway dashboard: https://railway.app
2. Select your project → Your service
3. Click **"Deployments"** tab
4. Click **"Redeploy"** button (or trigger a new deployment)

### Option 3: Force Redeploy via Git
If auto-deploy isn't working, push an empty commit:
```bash
git commit --allow-empty -m "Trigger Railway redeploy"
git push
```

## What Happens After Redeploy

Once Railway redeploys with the updated code:

1. ✅ Server starts
2. ✅ Database migrations run automatically
3. ✅ Missing columns are added:
   - `isCrossTrade` to `trades` table
   - `isRead` to `messages` table
   - `notifications` table is created
4. ✅ Dashboard loads without errors

## Temporary Workaround

I've updated the Dashboard to handle errors gracefully, so it won't break completely. But you'll still see:
- Empty trade lists
- Console warnings (not errors)
- Some features may not work until redeploy

## Verify It's Fixed

After redeploy, check Railway logs:
- Should see: `✅ Database schema initialized`
- Should NOT see: `SQLITE_ERROR: no such column`

Then test:
1. Log out and log back in
2. Dashboard should load without errors
3. Trades should display correctly

## Still Having Issues?

If errors persist after redeploy:
1. Check Railway logs for database errors
2. Verify the deployment completed successfully
3. Try clearing browser cache and cookies
4. Check that environment variables are still set correctly







