#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_SOURCE = 'https://asfacil-whatsapp-bot.onrender.com/reports';
const DEFAULT_SLUG = 'asfacil-community-reports';

function parseArgs(argv) {
  const options = {
    source: DEFAULT_SOURCE,
    slug: DEFAULT_SLUG,
    put: false,
    print: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source' && argv[i + 1]) {
      options.source = argv[i + 1];
      i += 1;
    } else if (arg === '--slug' && argv[i + 1]) {
      options.slug = argv[i + 1];
      i += 1;
    } else if (arg === '--put') {
      options.put = true;
    } else if (arg === '--no-print') {
      options.print = false;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Sync Asfacil WhatsApp community reports into GBrain

Usage:
  node scripts/sync-reports-to-gbrain.js [options]

Options:
  --source <url-or-file>   Source JSON endpoint or local reports.json
  --slug <slug>            GBrain page slug (default: ${DEFAULT_SLUG})
  --put                    Write/update the page in GBrain
  --no-print               Do not print the markdown summary
  --help                   Show this help

Examples:
  node scripts/sync-reports-to-gbrain.js
  node scripts/sync-reports-to-gbrain.js --source ./data/reports.json --put
  node scripts/sync-reports-to-gbrain.js --source https://asfacil-whatsapp-bot.onrender.com/reports --put
`);
}

async function readSource(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${source}: ${response.status}`);
    }
    return response.json();
  }

  const raw = await fs.promises.readFile(path.resolve(source), 'utf8');
  return JSON.parse(raw);
}

function normalizeReports(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.reports)) return payload.reports;
  return [];
}

function summarizeReports(reports) {
  const byCrossing = new Map();
  const byLane = new Map();

  for (const report of reports) {
    const crossing = report.crossing || 'Unknown';
    const laneKey = `${report.crossing || 'Unknown'} · ${report.lane || 'Unknown'}`;

    byCrossing.set(crossing, (byCrossing.get(crossing) || 0) + 1);
    byLane.set(laneKey, (byLane.get(laneKey) || 0) + 1);
  }

  const latest = reports
    .map((report) => report.createdAt)
    .filter(Boolean)
    .sort()
    .at(-1) || null;

  return {
    total: reports.length,
    latest,
    byCrossing: [...byCrossing.entries()].sort((a, b) => b[1] - a[1]),
    byLane: [...byLane.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
  };
}

function formatReport(report) {
  const note = report.note ? ` — ${report.note}` : '';
  return `- ${report.createdAt || 'unknown time'} | ${report.crossing || 'Unknown'} | ${report.mode || 'Unknown'} | ${report.lane || 'Unknown'} | ${report.reportedWaitMinutes ?? '?'} min${note}`;
}

function buildMarkdown(reports, summary, source) {
  const lines = [
    '---',
    'title: Asfacil Community Reports',
    'type: dataset',
    'status: active',
    'tags:',
    '  - asfacil',
    '  - whatsapp',
    '  - border',
    '  - reports',
    '---',
    '',
    '# Asfacil Community Reports',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Source: ${source}`,
    '',
    '## Snapshot',
    '',
    `- Total reports: ${summary.total}`,
    `- Latest report: ${summary.latest || 'none yet'}`,
    '',
  ];

  if (summary.byCrossing.length) {
    lines.push('## Reports by Crossing', '');
    lines.push(...summary.byCrossing.map(([crossing, count]) => `- ${crossing}: ${count}`));
    lines.push('');
  }

  if (summary.byLane.length) {
    lines.push('## Most Active Lanes', '');
    lines.push(...summary.byLane.map(([lane, count]) => `- ${lane}: ${count}`));
    lines.push('');
  }

  lines.push('## Recent Reports', '');
  if (!reports.length) {
    lines.push('No reports yet.');
  } else {
    lines.push(...reports.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 50).map(formatReport));
  }
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function putIntoGbrain(slug, markdown) {
  const tmpPath = path.join(os.tmpdir(), `${slug}-${Date.now()}.md`);
  fs.writeFileSync(tmpPath, markdown, 'utf8');
  try {
    execFileSync('gbrain', ['put', slug], {
      input: fs.readFileSync(tmpPath, 'utf8'),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    });
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    showHelp();
    return;
  }

  const payload = await readSource(options.source);
  const reports = normalizeReports(payload);
  const summary = summarizeReports(reports);
  const markdown = buildMarkdown(reports, summary, options.source);

  if (options.print) {
    process.stdout.write(markdown);
  }

  if (options.put) {
    putIntoGbrain(options.slug, markdown);
    console.log(`\n✓ Synced ${reports.length} reports to gbrain page: ${options.slug}`);
  }
}

main().catch((error) => {
  console.error(`sync failed: ${error.message}`);
  process.exit(1);
});
