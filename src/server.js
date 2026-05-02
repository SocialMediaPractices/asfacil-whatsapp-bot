require('dotenv').config();
const express = require('express');
const { getReplyForMessage } = require('./bot');
const { getTextFromWebhookBody, getWebhookEnvelopeSummary, sendWhatsAppText } = require('./whatsapp');
const { readReports, exportReportsMarkdown } = require('./reportStore');

const app = express();
app.use(express.json({ limit: '1mb' }));

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

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    logInfo('webhook_verify_success');
    return res.status(200).send(challenge);
  }

  logInfo('webhook_verify_failed', { mode });
  return res.sendStatus(403);
});

app.get('/reports', async (_req, res) => {
  try {
    const reports = await readReports();
    return res.json({ ok: true, count: reports.length, reports });
  } catch (error) {
    logError('reports_list_failed', error);
    return res.status(500).json({ ok: false, error: 'reports_list_failed' });
  }
});

app.get('/reports.md', async (_req, res) => {
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
    return res.status(500).json({
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
