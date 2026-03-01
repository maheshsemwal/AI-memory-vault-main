# Local Supabase Setup Guide

## Problem
Your network/firewall is blocking access to the cloud Supabase instance at `https://aqvabqjmjfpxspgljzla.supabase.co`

## Solution: Run Supabase Locally

### Prerequisites
- Docker Desktop installed and running
- PowerShell or Command Prompt

### Step 1: Install Docker Desktop
If not already installed:
1. Download from: https://www.docker.com/products/docker-desktop
2. Install and start Docker Desktop
3. Verify: `docker --version`

### Step 2: Install Supabase CLI

**Option A: Using Scoop (Recommended)**
```powershell
# Install Scoop if you don't have it
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
irm get.scoop.sh | iex

# Install Supabase CLI
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

**Option B: Using npm**
```powershell
npm install -g supabase
```

### Step 3: Initialize Supabase
```powershell
cd "d:\dev_drive\projects\AI Memory Vault"

# Initialize (creates supabase folder)
supabase init
```

### Step 4: Start Local Supabase
```powershell
supabase start
```

This will:
- Pull Docker images (first time only, ~2GB)
- Start PostgreSQL, PostgREST, Storage, Kong, etc.
- Take 2-3 minutes on first run

**Expected Output:**
```
Started supabase local development setup.

         API URL: http://localhost:54321
          DB URL: postgresql://postgres:postgres@localhost:54322/postgres
      Studio URL: http://localhost:54323
    Inbucket URL: http://localhost:54324
      JWT secret: super-secret-jwt-token-with-at-least-32-characters-long
        anon key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
service_role key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Step 5: Create Storage Bucket

Open Supabase Studio at `http://localhost:54323` and:

1. Go to **Storage** (left sidebar)
2. Click **New bucket**
3. Name: `aimemoryvault`
4. Set as **Private**
5. Click **Create bucket**

Or via SQL:
```sql
-- Run in Studio SQL Editor
INSERT INTO storage.buckets (id, name, public)
VALUES ('aimemoryvault', 'aimemoryvault', false);
```

### Step 6: Update .env File

**The .env file has been updated for you!** 

It now uses:
```dotenv
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=<your-local-key-from-step-4>
S3_BUCKET=aimemoryvault
```

**IMPORTANT:** Copy the `service_role key` from Step 4 output and update it in `.env`

### Step 7: Test Connection

```powershell
cd backend
bun run test-supabase.ts
```

You should see all green checkmarks! ✅

### Step 8: Run Your Application

```powershell
# Terminal 1: API Server
cd backend
bun run dev:api

# Terminal 2: Worker
cd backend
bun run dev:worker

# Terminal 3: Frontend
cd frontend
npm run dev
```

## Managing Local Supabase

```powershell
# Stop (keeps data)
supabase stop

# Start again
supabase start

# Reset (deletes all data)
supabase db reset

# View status
supabase status

# View logs
supabase logs
```

## Accessing Supabase Studio

Open http://localhost:54323 to:
- View database tables
- Browse storage files
- Write SQL queries
- Manage authentication
- View API logs

## Troubleshooting

### "Docker not found"
Make sure Docker Desktop is installed and running.

### "Port already in use"
Stop other services using ports 54321-54324:
```powershell
# Find process using port
netstat -ano | findstr :54321

# Kill process (replace PID)
taskkill /PID <PID> /F
```

### Storage bucket not accessible
Make sure you created the bucket in Studio (Step 5)

### Worker can't download files
1. Upload files through the frontend first
2. Check bucket permissions in Studio
3. Verify service_role key in `.env`

## Reverting to Cloud Supabase

When network issues are resolved, edit `.env`:

1. Comment out local config:
```dotenv
# SUPABASE_URL=http://localhost:54321
# SUPABASE_SERVICE_ROLE_KEY=<local-key>
```

2. Uncomment cloud config:
```dotenv
SUPABASE_URL=https://aqvabqjmjfpxspgljzla.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<cloud-key>
```

3. Stop local Supabase:
```powershell
supabase stop
```

## Network Troubleshooting (for cloud access)

If you want to fix the network issue instead:

1. **Check Windows Firewall** - Allow browser/Bun through firewall
2. **Change DNS** - Use Google DNS (8.8.8.8) or Cloudflare (1.1.1.1)
3. **Disable antivirus temporarily** - Test if it's blocking
4. **Try different network** - Mobile hotspot to test
5. **Check ISP** - Call ISP if they're blocking Supabase
6. **VPN** - Try with/without VPN
7. **Hosts file** - Check `C:\Windows\System32\drivers\etc\hosts`
8. **Check Supabase status** - https://status.supabase.com

## Benefits of Local Development

- ✅ **No network issues** - Everything runs locally
- ✅ **Faster** - No internet latency
- ✅ **Free** - No cloud costs during development
- ✅ **Offline** - Work without internet
- ✅ **Full control** - All data on your machine

## Next Steps

1. Install Docker Desktop
2. Install Supabase CLI
3. Run `supabase start`
4. Update service_role key in `.env`
5. Test with `bun run test-supabase.ts`
6. Upload a test file through the UI

Happy coding! 🚀
