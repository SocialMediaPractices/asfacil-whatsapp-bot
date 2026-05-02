const sessions = new Map();

function getSession(phone = 'local-test') {
  return sessions.get(phone) || null;
}

function setSession(phone = 'local-test', value) {
  sessions.set(phone, value);
  return value;
}

function clearSession(phone = 'local-test') {
  sessions.delete(phone);
}

module.exports = {
  getSession,
  setSession,
  clearSession,
};
