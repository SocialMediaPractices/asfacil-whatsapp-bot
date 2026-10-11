const crypto = require('crypto');

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Unsigned webhook bodies (including the bare {"message": "..."} test path) are
// only accepted when explicitly opted into for local development.
function allowUnsignedWebhooks() {
  return process.env.ALLOW_UNSIGNED_WEBHOOKS === 'true';
}

// Meta signs every webhook POST with the app secret: X-Hub-Signature-256: sha256=<hex HMAC of the raw body>.
function verifyMetaSignature(rawBody, header) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !rawBody || typeof header !== 'string') return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return safeEqual(header, expected);
}

// /reports carries reporter data, so it needs a bearer token. With no REPORTS_TOKEN set it stays closed.
function hasReportsAccess(req) {
  const token = process.env.REPORTS_TOKEN;
  if (!token) return false;
  return safeEqual(req.get('authorization') || '', `Bearer ${token}`);
}

module.exports = {
  safeEqual,
  allowUnsignedWebhooks,
  verifyMetaSignature,
  hasReportsAccess,
};
