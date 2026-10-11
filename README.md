# Asfacil WhatsApp Bot

WhatsApp bot for Asfacil focused on two jobs:

1. live San Diego–Tijuana crossing wait times
2. low-friction community reporting for early adopters who do not want to create a website profile

## Current state
- Express webhook server
- Live Asfacil northbound + southbound data integration
- English/Spanish bot replies
- Guided `report` flow for community submissions
- Inline report parsing like `report otay ready 45 slow at the turn`
- Local JSON persistence for reports at `data/reports.json`
- Report export endpoints at `/reports` and `/reports.md`
- Optional upstream forwarding via `ASFACIL_REPORT_WEBHOOK_URL`
- Meta WhatsApp webhook parsing scaffold
- Meta status/non-text events safely acknowledged
- Outbound WhatsApp send helper guarded by env flag
- Basic request and webhook logging
- No real WhatsApp sends unless `WHATSAPP_SEND_ENABLED=true`

## Run locally

```bash
cp .env.example .env
node src/server.js
```

## Test locally

### Simple local test
```bash
curl -s http://localhost:3000/
curl -s http://localhost:3000/healthz
curl -s -X POST http://localhost:3000/webhook \
  -H 'Content-Type: application/json' \
  -d '{"message":"wait times otay"}'

curl -s -X POST http://localhost:3000/webhook \
  -H 'Content-Type: application/json' \
  -d '{"message":"report"}'

curl -s -X POST http://localhost:3000/webhook \
  -H 'Content-Type: application/json' \
  -d '{"message":"report otay ready 45 slow near curva"}'

curl -s -H "Authorization: Bearer $REPORTS_TOKEN" http://localhost:3000/reports | jq
curl -s -H "Authorization: Bearer $REPORTS_TOKEN" http://localhost:3000/reports.md
```

These unsigned test requests only work with `ALLOW_UNSIGNED_WEBHOOKS=true`, which `.env.example` sets for local use.

### Meta-style webhook test (safe by default)
```bash
curl -s -X POST http://localhost:3000/webhook \
  -H 'Content-Type: application/json' \
  -d '{
    "entry": [{
      "changes": [{
        "value": {
          "messages": [{
            "from": "15551234567",
            "type": "text",
            "text": { "body": "wait times otay" }
          }]
        }
      }]
    }]
  }'
```

### Meta status callback test
```bash
curl -s -X POST http://localhost:3000/webhook \
  -H 'Content-Type: application/json' \
  -d '{
    "entry": [{
      "changes": [{
        "value": {
          "statuses": [{
            "id": "wamid.test",
            "status": "delivered"
          }]
        }
      }]
    }]
  }'
```

## Required env vars for real WhatsApp sends
- `VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET` — Meta app secret; every webhook POST must carry a valid `X-Hub-Signature-256` or it is rejected with 401
- `WHATSAPP_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_SEND_ENABLED=true`

## Optional env vars
- `REPORTS_TOKEN` — bearer token for `/reports` and `/reports.md` (both return 401 without it); the GBrain sync script sends it from the same variable
- `ALLOW_UNSIGNED_WEBHOOKS=true` — local development only; accepts webhook POSTs without a Meta signature
- `ASFACIL_REPORT_WEBHOOK_URL` — forward saved reports to another backend after local persistence

## Existing-stack fit
- **Asfacil API** remains the live source for wait times
- **WhatsApp bot** collects low-friction community reports
- **`/reports`** gives JSON for API/automation consumers
- **`/reports.md`** gives a markdown export that fits OpenClaw/GBrain workflows

## Sync reports into GBrain

Use the included sync script to turn saved WhatsApp reports into a structured GBrain page.

```bash
# Preview the generated markdown
node scripts/sync-reports-to-gbrain.js

# Sync local report data into gbrain
npm run sync:gbrain

# Sync from a specific source
node scripts/sync-reports-to-gbrain.js --source ./data/reports.json --put
node scripts/sync-reports-to-gbrain.js --source https://asfacil-whatsapp-bot.onrender.com/reports --put
```

Default GBrain page slug:
- `asfacil-community-reports`

## Deploy on Render
This repo now includes `render.yaml` for a straightforward web service deploy.

Suggested flow:
1. Create a new Render web service from this repo
2. Use the included `render.yaml`
3. Set secrets in Render:
   - `VERIFY_TOKEN`
   - `WHATSAPP_APP_SECRET`
   - `WHATSAPP_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `REPORTS_TOKEN`
4. Keep `WHATSAPP_SEND_ENABLED=false` for the first live webhook test
5. Point Meta webhook callback to:
   - `https://<your-render-domain>/webhook`
6. After verification, flip `WHATSAPP_SEND_ENABLED=true`

## Safety
By default, outbound sends are disabled. The bot will return a preview instead of sending.

## Logging
The server logs:
- inbound HTTP requests
- webhook verification attempts
- inbound message processing
- send-preview vs real-send path
- structured processing errors

## Next steps
1. Point `ASFACIL_REPORT_WEBHOOK_URL` at the future Asfacil ingestion endpoint
2. Decide whether reports should also create GBrain entries or stay app-only
3. Deploy webhook endpoint
4. Turn on real sending only after a final test
