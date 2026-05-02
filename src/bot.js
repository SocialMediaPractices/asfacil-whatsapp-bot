const {
  getCurrentWaitTimes,
  getSouthboundWaitTimes,
  getFastestCrossing,
  normalizeCrossing,
  normalizeLane,
  normalizeMode,
  submitCommunityReport,
  getRecentCommunityReportsSummary,
} = require('./dataService');
const { getSession, setSession, clearSession } = require('./sessionStore');

function detectLanguage(text = '') {
  const lower = text.toLowerCase().trim();
  const spanishHints = [
    'hola', 'tiempo', 'tiempos', 'frontera', 'cruce', 'espera', 'rapido', 'rápido',
    'mas rapido', 'más rápido', 'alerta', 'reporte', 'méxico', 'hacia mexico',
    'hacia méxico', 'peaton', 'peatonal', 'vehiculo', 'vehículo', 'lista', 'ayuda',
    'sur', 'comunidad', 'grupo', 'linea', 'línea', 'minutos'
  ];
  return spanishHints.some((word) => lower.includes(word)) ? 'es' : 'en';
}

function getMenu(language) {
  return language === 'es'
    ? [
        'Puedo ayudarte con:',
        '• tiempos — ver cruces hacia USA',
        '• hacia méxico — ver tiempos al sur',
        '• más rápido — ver la mejor opción ahora',
        '• otay / san ysidro / sentri / ready / peatonal — filtrar resultados',
        '• reporte — enviar tu tiempo de línea sin crear perfil',
        '• reportes recientes — ver los últimos reportes de la comunidad',
        '• cancelar — salir del flujo actual',
      ].join('\n')
    : [
        'I can help with:',
        '• wait times — see crossings to the USA',
        '• to mexico — see southbound times',
        '• fastest — see the best crossing right now',
        '• otay / san ysidro / sentri / ready / pedestrian — filter results',
        '• report — submit your line time without creating a profile',
        '• recent reports — see recent community reports',
        '• cancel — exit the current flow',
      ].join('\n');
}

function extractFilters(text) {
  const lower = text.toLowerCase();
  return {
    crossing: lower.includes('otay')
      ? 'otay mesa'
      : lower.includes('san ysidro')
        ? 'san ysidro'
        : lower.includes('pedwest')
          ? 'pedwest'
          : null,
    lane: lower.includes('sentri')
      ? 'sentri'
      : lower.includes('ready') || lower.includes('ready lane')
        ? 'ready'
        : lower.includes('general')
          ? 'general'
          : null,
    mode: lower.includes('pedestrian') || lower.includes('pedestriano') || lower.includes('peaton') || lower.includes('peatonal')
      ? 'pedestrian'
      : lower.includes('vehicle') || lower.includes('car') || lower.includes('carro') || lower.includes('vehiculo') || lower.includes('vehículo')
        ? 'vehicle'
        : null,
  };
}

function applyFilters(times, filters) {
  return times.filter((t) => {
    if (filters.crossing && t.crossing.toLowerCase() !== filters.crossing) return false;
    if (filters.lane && t.lane.toLowerCase() !== filters.lane) return false;
    if (filters.mode && String(t.mode || '').toLowerCase() !== filters.mode) return false;
    return true;
  });
}

function sortByWaitTime(times) {
  return [...times].sort((a, b) => a.waitMinutes - b.waitMinutes);
}

function formatWaitTimes(times, language, title) {
  const header = title || (language === 'es' ? 'Tiempos actuales estimados:' : 'Current estimated wait times:');
  const body = times.map((t) => {
    const modePart = t.mode ? `${t.mode} · ` : '';
    return `• ${t.crossing} · ${modePart}${t.lane}: ${t.waitMinutes} min`;
  });
  return [header, ...body].join('\n');
}

function formatFastest(best, language) {
  const modePart = best.mode ? `${best.mode}, ` : '';
  if (language === 'es') {
    return `La opción más rápida ahora es ${best.crossing} (${modePart}${best.lane}, ${best.direction}) con ~${best.waitMinutes} min.`;
  }
  return `The fastest option right now is ${best.crossing} (${modePart}${best.lane}, ${best.direction}) at ~${best.waitMinutes} min.`;
}

function formatNoResults(language) {
  return language === 'es'
    ? 'No encontré resultados para ese filtro. Prueba con “tiempos otay”, “sentri”, o “peatonal”.'
    : 'I could not find results for that filter. Try “wait times otay”, “sentri”, or “pedestrian”.';
}

function formatRecentReports(reports, language) {
  if (!reports.length) {
    return language === 'es'
      ? 'Todavía no hay reportes guardados de la comunidad.'
      : 'There are no saved community reports yet.';
  }

  const header = language === 'es' ? 'Reportes recientes:' : 'Recent community reports:';
  const lines = reports.map((report) => `• ${report.crossing} · ${report.lane}: ${report.reportedWaitMinutes} min${report.note ? ` — ${report.note}` : ''}`);
  return [header, ...lines].join('\n');
}

function formatReportSaved(result, language) {
  const report = result.report;
  return language === 'es'
    ? `Gracias. Guardé tu reporte para ${report.crossing} (${report.lane}) con ${report.reportedWaitMinutes} min.${report.note ? ` Nota: ${report.note}` : ''}`
    : `Thanks. I saved your report for ${report.crossing} (${report.lane}) at ${report.reportedWaitMinutes} min.${report.note ? ` Note: ${report.note}` : ''}`;
}

function formatReportPrompt(step, language) {
  const prompts = {
    crossing: {
      en: 'Which crossing? Reply with Otay, San Ysidro, or Pedwest.',
      es: '¿Qué cruce? Responde con Otay, San Ysidro, o Pedwest.',
    },
    lane: {
      en: 'Which lane or mode? Example: Ready, Sentri, General, or Pedestrian.',
      es: '¿Qué carril o modo? Ejemplo: Ready, Sentri, General, o Peatonal.',
    },
    wait: {
      en: 'About how many minutes have you been waiting? Reply with a number like 45.',
      es: '¿Cuántos minutos llevas esperando? Responde con un número como 45.',
    },
    note: {
      en: 'Any short note? You can mention traffic, line movement, or reply “skip”.',
      es: '¿Alguna nota corta? Puedes mencionar tráfico, si avanza la fila, o responder “skip”.',
    },
  };
  return prompts[step]?.[language] || prompts[step]?.en;
}

function parseReportInline(text) {
  const match = text.match(/report(?:e)?\s+(.+?)\s+(sentri|ready|general|pedestrian|peatonal)?\s*(\d{1,3})(?:\s+(.+))?$/i);
  if (!match) return null;
  const crossing = normalizeCrossing(match[1]);
  if (!crossing) return null;
  return {
    crossing: crossing.crossing,
    lane: match[2] || 'General',
    reportedWaitMinutes: Number(match[3]),
    note: match[4] || '',
  };
}

async function continueReportFlow({ phone, text, language }) {
  const session = getSession(phone);
  if (!session) return null;

  const input = String(text || '').trim();
  if (!input) return formatReportPrompt(session.step, language);

  if (session.step === 'crossing') {
    const crossing = normalizeCrossing(input);
    if (!crossing) return formatReportPrompt('crossing', language);
    setSession(phone, { ...session, step: 'lane', data: { ...session.data, crossing: crossing.crossing } });
    return formatReportPrompt('lane', language);
  }

  if (session.step === 'lane') {
    const lane = normalizeLane(input) || normalizeMode(input);
    if (!lane) return formatReportPrompt('lane', language);
    setSession(phone, { ...session, step: 'wait', data: { ...session.data, lane } });
    return formatReportPrompt('wait', language);
  }

  if (session.step === 'wait') {
    const wait = Number(input.match(/\d{1,3}/)?.[0]);
    if (!Number.isFinite(wait) || wait < 0) return formatReportPrompt('wait', language);
    setSession(phone, { ...session, step: 'note', data: { ...session.data, reportedWaitMinutes: wait } });
    return formatReportPrompt('note', language);
  }

  if (session.step === 'note') {
    const note = /^(skip|none|ninguna|no)$/i.test(input) ? '' : input;
    const result = await submitCommunityReport({ phone, ...session.data, note });
    clearSession(phone);
    return formatReportSaved(result, language);
  }

  return null;
}

async function getReplyForMessage({ text, from }) {
  const language = detectLanguage(text);
  const lower = (text || '').toLowerCase().trim();
  const phone = from || 'local-test';
  const filters = extractFilters(lower);

  if (lower === 'cancel' || lower === 'cancelar') {
    clearSession(phone);
    return language === 'es' ? 'Listo, cancelé ese flujo.' : 'Done, I cancelled that flow.';
  }

  const continued = await continueReportFlow({ phone, text, language });
  if (continued) return continued;

  if (!text || lower.includes('help') || lower.includes('ayuda') || lower.includes('menu')) {
    return getMenu(language);
  }

  if (lower.includes('recent reports') || lower.includes('reportes recientes')) {
    return formatRecentReports(await getRecentCommunityReportsSummary(), language);
  }

  if (lower === 'report' || lower === 'reporte') {
    setSession(phone, { step: 'crossing', language, data: {} });
    return formatReportPrompt('crossing', language);
  }

  if (lower.includes('report') || lower.includes('reporte')) {
    const inline = parseReportInline(text);
    if (inline) {
      const result = await submitCommunityReport({ phone, ...inline });
      return formatReportSaved(result, language);
    }

    setSession(phone, { step: 'crossing', language, data: {} });
    return formatReportPrompt('crossing', language);
  }

  if (lower.includes('to mexico') || lower.includes('southbound') || lower.includes('hacia mexico') || lower.includes('hacia méxico') || lower === 'mexico' || lower === 'méxico') {
    const times = applyFilters(await getSouthboundWaitTimes(), filters);
    const sorted = sortByWaitTime(times);
    if (!sorted.length) return formatNoResults(language);
    return formatWaitTimes(sorted, language, language === 'es' ? 'Tiempos estimados hacia México:' : 'Current estimated southbound times:');
  }

  if (lower.includes('fastest') || lower.includes('más rápido') || lower.includes('mas rapido') || lower.includes('quickest')) {
    const best = await getFastestCrossing('northbound');
    return formatFastest(best, language);
  }

  if (
    lower.includes('wait') ||
    lower.includes('tiempos') ||
    lower === 'time' ||
    lower.includes('espera') ||
    filters.crossing ||
    filters.lane ||
    filters.mode
  ) {
    const times = applyFilters(await getCurrentWaitTimes(), filters);
    const sorted = sortByWaitTime(times);
    if (!sorted.length) return formatNoResults(language);
    return formatWaitTimes(sorted, language);
  }

  return language === 'es'
    ? `No entendí eso.\n\n${getMenu(language)}`
    : `I did not understand that.\n\n${getMenu(language)}`;
}

module.exports = {
  getReplyForMessage,
};
