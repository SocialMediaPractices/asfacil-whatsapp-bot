const { appendReport, listRecentReports } = require('./reportStore');

const ASFACIL_BASE_URL = process.env.ASFACIL_BASE_URL || 'https://asfacil.com';
const ASFACIL_REPORT_WEBHOOK_URL = process.env.ASFACIL_REPORT_WEBHOOK_URL || '';

function titleCase(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

async function fetchJson(path) {
  const response = await fetch(`${ASFACIL_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status}`);
  }
  return response.json();
}

async function getCurrentWaitTimes() {
  const data = await fetchJson('/api/cbp');
  const crossings = data.crossings || [];

  return crossings.flatMap((crossing) =>
    (crossing.modes || []).flatMap((mode) =>
      (mode.lanes || []).map((lane) => ({
        crossing: titleCase(crossing.crossingId),
        crossingId: crossing.crossingId,
        direction: 'To USA',
        mode: titleCase(mode.mode),
        lane: titleCase(lane.lane),
        waitMinutes: lane.delayMinutes,
        lanesOpen: lane.lanesOpen,
        operationalStatus: lane.operationalStatus,
        lastUpdated: crossing.lastUpdated,
      }))
    )
  );
}

async function getSouthboundWaitTimes() {
  const data = await fetchJson('/api/southbound');
  const crossings = data.crossings || [];

  return crossings.map((crossing) => ({
    crossing: titleCase(crossing.crossingId),
    crossingId: crossing.crossingId,
    direction: 'To Mexico',
    mode: 'Vehicle',
    lane: 'General',
    waitMinutes: crossing.estimatedMinutes,
    level: crossing.level,
    dataSource: crossing.dataSource,
    patternReason: crossing.patternReason,
  }));
}

async function getFastestCrossing(direction = 'northbound') {
  const times = direction === 'southbound'
    ? await getSouthboundWaitTimes()
    : await getCurrentWaitTimes();

  return times.reduce((best, current) =>
    current.waitMinutes < best.waitMinutes ? current : best
  );
}

function normalizeCrossing(value = '') {
  const lower = String(value).trim().toLowerCase();
  if (!lower) return null;
  if (lower.includes('otay')) return { crossingId: 'otay_mesa', crossing: 'Otay Mesa' };
  if (lower.includes('pedwest') || lower.includes('ped west')) return { crossingId: 'pedwest', crossing: 'Pedwest' };
  if (lower.includes('san') || lower.includes('ysid') || lower.includes('sidro')) {
    return { crossingId: 'san_ysidro', crossing: 'San Ysidro' };
  }
  return null;
}

function normalizeLane(value = '') {
  const lower = String(value).trim().toLowerCase();
  if (!lower) return null;
  if (lower.includes('sentri')) return 'Sentri';
  if (lower.includes('ready')) return 'Ready';
  if (lower.includes('general') || lower.includes('normal') || lower.includes('regular')) return 'General';
  return null;
}

function normalizeMode(value = '') {
  const lower = String(value).trim().toLowerCase();
  if (!lower) return null;
  if (lower.includes('ped') || lower.includes('peat')) return 'Pedestrian';
  if (lower.includes('veh') || lower.includes('car') || lower.includes('auto')) return 'Vehicle';
  return null;
}

async function createAlertSubscription({ phone, crossing, thresholdMinutes, language }) {
  return {
    success: true,
    subscription: {
      phone,
      crossing,
      thresholdMinutes,
      language,
      status: 'mocked',
    },
  };
}

async function submitCommunityReport({ phone, crossing, lane, reportedWaitMinutes, note }) {
  const normalizedCrossing = normalizeCrossing(crossing);
  const normalizedLane = normalizeLane(lane) || 'General';
  const report = {
    phone,
    crossingId: normalizedCrossing?.crossingId || null,
    crossing: normalizedCrossing?.crossing || crossing,
    lane: normalizedLane,
    mode: normalizeMode(lane) || 'Vehicle',
    reportedWaitMinutes,
    note: note || '',
    source: 'whatsapp',
    createdAt: new Date().toISOString(),
  };

  const stored = await appendReport(report);

  let forwarded = null;
  if (ASFACIL_REPORT_WEBHOOK_URL) {
    try {
      const response = await fetch(ASFACIL_REPORT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stored),
      });

      forwarded = {
        ok: response.ok,
        status: response.status,
      };
    } catch (error) {
      forwarded = {
        ok: false,
        error: error.message,
      };
    }
  }

  return {
    success: true,
    report: stored,
    forwarded,
  };
}

async function getRecentCommunityReportsSummary(limit = 5) {
  return listRecentReports(limit);
}

module.exports = {
  getCurrentWaitTimes,
  getSouthboundWaitTimes,
  getFastestCrossing,
  normalizeCrossing,
  normalizeLane,
  normalizeMode,
  createAlertSubscription,
  submitCommunityReport,
  getRecentCommunityReportsSummary,
};
