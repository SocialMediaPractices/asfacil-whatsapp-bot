require('dotenv').config();
const express = require('express');
const { getReplyForMessage } = require('./bot');
const { getTextFromWebhookBody, getWebhookEnvelopeSummary, sendWhatsAppText } = require('./whatsapp');
const { readReports, exportReportsMarkdown } = require('./reportStore');
const { safeEqual, allowUnsignedWebhooks, verifyMetaSignature, hasReportsAccess } = require('./security');

const app = express();
app.use(express.json({
  limit: '1mb',
  // Keep the exact bytes Meta signed; the HMAC must be computed over the raw body, not re-serialized JSON.
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
}));

function logInfo(event, meta = {}) {
  console.log(JSON.stringify({ level: 'info', event, ...meta }));
}

function logError(event, error, meta = {}) {
  console.error(JSON.stringify({
    level: 'error',
    event,
    message: error?.message || 'Unknown error',
    ...meta,
  }));
}

app.use((req, _res, next) => {
  logInfo('http_request', {
    method: req.method,
    path: req.path,
  });
  next();
});

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'asfacil-whatsapp-bot' });
});

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'asfacil-whatsapp-bot', status: 'healthy' });
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && safeEqual(token, process.env.VERIFY_TOKEN)) {
    logInfo('webhook_verify_success');
    return res.status(200).send(challenge);
  }

  logInfo('webhook_verify_failed', { mode });
  return res.sendStatus(403);
});

function requireReportsAccess(req, res, next) {
  if (hasReportsAccess(req)) return next();
  return res.status(401).json({ ok: false, error: 'unauthorized' });
}

app.get('/reports', requireReportsAccess, async (_req, res) => {
  try {
    const reports = await readReports();
    // Reporter phone numbers never leave the service, even to authorized consumers.
    const publicReports = reports.map(({ phone: _phone, ...report }) => report);
    return res.json({ ok: true, count: publicReports.length, reports: publicReports });
  } catch (error) {
    logError('reports_list_failed', error);
    return res.status(500).json({ ok: false, error: 'reports_list_failed' });
  }
});

app.get('/reports.md', requireReportsAccess, async (_req, res) => {
  try {
    const markdown = await exportReportsMarkdown();
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    return res.send(markdown);
  } catch (error) {
    logError('reports_markdown_failed', error);
    return res.status(500).json({ ok: false, error: 'reports_markdown_failed' });
  }
});

app.post('/webhook', async (req, res) => {
  const signed = verifyMetaSignature(req.rawBody, req.get('x-hub-signature-256'));
  if (!signed && !allowUnsignedWebhooks()) {
    logInfo('webhook_signature_rejected', {
      hasSignature: Boolean(req.get('x-hub-signature-256')),
      hasAppSecret: Boolean(process.env.WHATSAPP_APP_SECRET),
    });
    return res.sendStatus(401);
  }

  try {
    const envelope = getWebhookEnvelopeSummary(req.body);
    const parsed = getTextFromWebhookBody(req.body);

    if (parsed?.text) {
      logInfo('webhook_message_received', {
        via: 'meta-webhook',
        from: parsed.from,
        type: parsed.type,
      });

      const reply = await getReplyForMessage({ text: parsed.text, from: parsed.from });
      const delivery = await sendWhatsAppText({
        to: parsed.from,
        body: reply,
      });

      logInfo('webhook_message_processed', {
        via: 'meta-webhook',
        from: parsed.from,
        deliverySkipped: Boolean(delivery?.skipped),
      });

      return res.json({ ok: true, via: 'meta-webhook', parsed, reply, delivery });
    }

    if (envelope.hasStatuses) {
      logInfo('webhook_status_received', {
        via: 'meta-webhook',
      });
      return res.json({ ok: true, via: 'meta-webhook', ignored: 'status_event' });
    }

    if (envelope.hasMessages) {
      logInfo('webhook_non_text_message_ignored', {
        via: 'meta-webhook',
      });
      return res.json({ ok: true, via: 'meta-webhook', ignored: 'non_text_message' });
    }

    if (signed) {
      // A genuine Meta callback that carries neither messages nor statuses; nothing to do.
      return res.json({ ok: true, via: 'meta-webhook', ignored: 'empty_event' });
    }

    const message = req.body?.message || req.body?.text || '';
    logInfo('webhook_message_received', {
      via: 'local-test',
      hasMessage: Boolean(message),
    });

    const reply = await getReplyForMessage({ text: message, from: 'local-test' });
    logInfo('webhook_message_processed', {
      via: 'local-test',
    });

    return res.json({ ok: true, via: 'local-test', reply });
  } catch (error) {
    logError('webhook_processing_failed', error, {
      path: '/webhook',
    });
    // Acknowledge anyway: a non-2xx makes Meta retry the same event repeatedly, multiplying the failure.
    return res.status(200).json({
      ok: false,
      error: 'internal_error',
      message: 'Webhook processing failed',
    });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  logInfo('server_started', { port });
  console.log(`Asfacil WhatsApp bot listening on port ${port}`);
});
