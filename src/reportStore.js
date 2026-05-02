const fs = require('fs/promises');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const REPORTS_PATH = path.join(DATA_DIR, 'reports.json');

function formatReportLine(report) {
  const note = report.note ? ` — ${report.note}` : '';
  return `- ${report.createdAt}: ${report.crossing} | ${report.mode} | ${report.lane} | ${report.reportedWaitMinutes} min${note}`;
}

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(REPORTS_PATH);
  } catch {
    await fs.writeFile(REPORTS_PATH, '[]\n', 'utf8');
  }
}

async function readReports() {
  await ensureDataFile();
  const raw = await fs.readFile(REPORTS_PATH, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeReports(reports) {
  await ensureDataFile();
  await fs.writeFile(REPORTS_PATH, `${JSON.stringify(reports, null, 2)}\n`, 'utf8');
}

async function appendReport(report) {
  const reports = await readReports();
  const stored = {
    id: `rpt_${Date.now()}`,
    ...report,
  };
  reports.push(stored);
  await writeReports(reports);
  return stored;
}

async function listRecentReports(limit = 5) {
  const reports = await readReports();
  return reports.slice(-limit).reverse();
}

async function exportReportsMarkdown(limit = 50) {
  const reports = await readReports();
  const selected = reports.slice(-limit).reverse();

  const lines = [
    '# Asfacil Community Reports',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
  ];

  if (!selected.length) {
    lines.push('No reports yet.');
    return `${lines.join('\n')}\n`;
  }

  lines.push('## Recent Reports', '');
  lines.push(...selected.map(formatReportLine));
  lines.push('');

  return `${lines.join('\n')}\n`;
}

module.exports = {
  appendReport,
  readReports,
  listRecentReports,
  exportReportsMarkdown,
};
