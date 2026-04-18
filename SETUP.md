# Unity Kitty Hunter — Setup Guide
# @unityoneth | Monthly Competition | 1,000,000,000,000 UNITY Prize
# ETH Mainnet | Manual payout | 0xFd0bb211d479710dFa01d3d98751767F51edb2d9

## Quick start
1. npm install
2. cp .env.example .env  → fill in BOT_TOKEN, CHANNEL_ID, MINI_APP_URL, ADMIN_SECRET
3. node server/server.js

## Deploy (Railway)
Push to GitHub → connect Railway → add env vars → done.
Railway gives you a free HTTPS URL for the Mini App.

## Register Mini App
@BotFather → /newapp → paste your Railway URL → get t.me/yourbot/unitykitty link

## Set webhook
https://api.telegram.org/botTOKEN/setWebhook?url=https://YOUR_URL/webhook

## Bot commands: /start /play /leaderboard /wallet /status

## Monthly payout flow
1. Server auto-announces winner on 1st of month at midnight UTC
2. You send 1,000,000,000,000 UNITY tokens from 0xFd0bb211d479710dFa01d3d98751767F51edb2d9 to winner wallet
3. curl -X POST /admin/mark-paid -H "x-admin-secret: SECRET" -d '{"period":"2025-04","txHash":"0x..."}'
4. Bot posts Etherscan link to @unityoneth automatically

## Admin endpoints (header: x-admin-secret)
GET  /admin/summary              — current standings + winner wallet
POST /admin/announce             — manually trigger announcement {period}
POST /admin/mark-paid            — mark prize sent {period, txHash}

## Full guide: see SETUP.md (full version in the zip)
