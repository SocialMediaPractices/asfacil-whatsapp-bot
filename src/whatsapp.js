const GRAPH_API_BASE = 'https://graph.facebook.com/v22.0';

function getTextFromWebhookBody(body) {
  const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) return null;

  const from = message.from || null;
  const type = message.type || null;

  if (type === 'text') {
    return {
      from,
      type,
      text: message.text?.body || '',
      raw: message,
    };
  }

  return {
    from,
    type,
    text: '',
    raw: message,
  };
}

function getWebhookEnvelopeSummary(body) {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  return {
    hasMessages: Array.isArray(value?.messages) && value.messages.length > 0,
    hasStatuses: Array.isArray(value?.statuses) && value.statuses.length > 0,
    metadata: value?.metadata || null,
  };
}

async function sendWhatsAppText({ to, body }) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const enabled = process.env.WHATSAPP_SEND_ENABLED === 'true';

  if (!enabled) {
    return {
      ok: true,
      skipped: true,
      reason: 'WHATSAPP_SEND_ENABLED is not true',
      preview: { to, body },
    };
  }

  if (!token || !phoneNumberId) {
    throw new Error('Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID');
  }

  const response = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`WhatsApp send failed: ${response.status} ${JSON.stringify(data)}`);
  }

  return {
    ok: true,
    skipped: false,
    data,
  };
}

module.exports = {
  getTextFromWebhookBody,
  getWebhookEnvelopeSummary,
  sendWhatsAppText,
};
