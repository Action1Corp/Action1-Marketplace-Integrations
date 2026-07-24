import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import html2canvas from 'html2canvas';
import {
  ShieldAlert,
  Server,
  CheckCircle2,
  AlertTriangle,
  Activity,
  Cpu,
  Globe,
  BarChart3,
  Calendar,
  Printer,
  RefreshCw
} from 'lucide-react';

const iconMap = {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Cpu,
  Globe,
  Server,
  ShieldAlert
};

const defaultDashboard = {
  "component": "metric-dashboard",
  "title": "{integrationName} Vulnerability Summary",
  "description": "Comprehensive analysis of endpoint security posture across {integrationName} and Action1.",
  "kpis": [
    {
      "label": "ASSET SYNC RATE",
      "metric": "syncRate",
      "color": "#1D8EE6",
      "tone": "blue"
    },
    {
      "label": "PATCHABILITY RATE",
      "metric": "patchRate",
      "color": "#10b981",
      "tone": "green"
    },
    {
      "label": "TOTAL VULNERABILITIES",
      "metric": "totalCves",
      "color": "#111827",
      "tone": "gray",
      "to": "vulnerabilities"
    }
  ],
  "sections": [
    {
      "title": "Asset Intelligence Coverage",
      "cards": [
        {
          "label": "{integrationName} Inventory",
          "metric": "totalIntegrationAssets",
          "color": "#1D8EE6",
          "to": "endpoints?filter=appAssets",
          "icon": "Globe",
          "subtitle": "Active assets identified in {integrationName}"
        },
        {
          "label": "Action1 Managed",
          "metric": "totalAction1Assets",
          "color": "#10b981",
          "to": "endpoints?filter=action1Assets",
          "icon": "Server",
          "subtitle": "Endpoints under Action1 management"
        },
        {
          "label": "Audit Gap: {integrationName}",
          "metric": "missingFromIntegration",
          "color": "#f97316",
          "to": "endpoints?filter=missingApp",
          "icon": "Activity",
          "subtitle": "In Action1 but not found in {integrationName}"
        },
        {
          "label": "Audit Gap: Action1",
          "metric": "missingFromAction1",
          "color": "#ef4444",
          "to": "endpoints?filter=missingAction1",
          "icon": "AlertTriangle",
          "subtitle": "In {integrationName} but missing Action1 agent"
        }
      ]
    },
    {
      "title": "Threat Severity Profile",
      "cards": [
        {
          "label": "Critical",
          "metric": "totalCritical",
          "color": "#ef4444",
          "to": "vulnerabilities?severity=Critical",
          "icon": "ShieldAlert",
          "subtitle": "Immediate corrective action required"
        },
        {
          "label": "High",
          "metric": "totalHigh",
          "color": "#f97316",
          "to": "vulnerabilities?severity=High",
          "icon": "AlertTriangle",
          "subtitle": "Significant risk of exploitation"
        },
        {
          "label": "Medium",
          "metric": "totalMedium",
          "color": "#eab308",
          "to": "vulnerabilities?severity=Medium",
          "icon": "Activity",
          "subtitle": "Targeted remediation recommended"
        },
        {
          "label": "Low",
          "metric": "totalLow",
          "color": "#3b82f6",
          "to": "vulnerabilities?severity=Low",
          "icon": "BarChart3",
          "subtitle": "Minor security anomalies"
        }
      ]
    },
    {
      "title": "Distribution",
      "type": "severityDistribution"
    },
    {
      "title": "Remediation Strategy & Readiness",
      "columns": 2,
      "cards": [
        {
          "label": "Patch Available",
          "metric": "totalPatchable",
          "color": "#10b981",
          "to": "vulnerabilities?status=Patch Available",
          "icon": "CheckCircle2",
          "subtitle": "CVEs with an Action1 deployable software patch"
        },
        {
          "label": "Non Patchable",
          "metric": "totalNotPatchable",
          "color": "#ef4444",
          "to": "vulnerabilities?status=Non Patchable",
          "icon": "AlertTriangle",
          "subtitle": "CVEs without an Action1 deployable software patch"
        }
      ]
    }
  ]
};

const dashboardCache = new Map();
const integrationDefCache = new Map();

function tokenText(value, integrationName) {
  return String(value || '').replaceAll('{integrationName}', integrationName);
}

function metricValue(metric, stats) {
  const remediationTotal = (stats.totalPatchable || 0) + (stats.totalNotPatchable || 0);
  const severityTotal = (stats.totalCritical || 0) + (stats.totalHigh || 0) + (stats.totalMedium || 0) + (stats.totalLow || 0);
  const totalCves = remediationTotal || severityTotal;
  const computed = {
    totalCves,
    patchRate: remediationTotal > 0 ? Math.round(((stats.totalPatchable || 0) / remediationTotal) * 100) : 0,
    syncRate: stats.totalIntegrationAssets > 0 ? Math.round(((stats.totalAction1Assets || 0) / stats.totalIntegrationAssets) * 100) : 0
  };
  return Object.prototype.hasOwnProperty.call(computed, metric) ? computed[metric] : (stats[metric] ?? 0);
}

function targetPath(integration, to = '') {
  if (!to) return `/apps/${integration}/dashboard`;
  return `/apps/${integration}/${to}`;
}

function compactSyncDetails(details = '') {
  const text = String(details || '').trim();
  if (!text) return 'No additional sync details were reported.';
  if (text.includes('Marketplace restarted while this sync was running')) {
    return 'The previous sync was interrupted by a marketplace restart. Start a new sync when ready.';
  }

  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const latestLine = lines[lines.length - 1] || text;
  return latestLine.length > 220 ? `${latestLine.slice(0, 217)}...` : latestLine;
}

function exportDateStamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function safeFileName(value) {
  return String(value || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function copyComputedStyles(source, target) {
  const computed = window.getComputedStyle(source);
  for (let i = 0; i < computed.length; i += 1) {
    const property = computed[i];
    target.style.setProperty(property, computed.getPropertyValue(property), computed.getPropertyPriority(property));
  }
  Array.from(source.children).forEach((child, index) => {
    if (target.children[index]) copyComputedStyles(child, target.children[index]);
  });
}

function base64ToBinary(base64) {
  const raw = window.atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function binaryString(bytes) {
  let output = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    output += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return output;
}

function buildImagePdf(imagePages) {
  const pageWidth = 792;
  const pageHeight = 612;
  const margin = 22;
  const objects = [{ body: '<< /Type /Catalog /Pages 2 0 R >>' }, { body: '' }];
  const pageRefs = [];

  imagePages.forEach(page => {
    const pageId = objects.length + 1;
    const imageId = objects.length + 2;
    const contentId = objects.length + 3;
    pageRefs.push(`${pageId} 0 R`);
    const drawWidth = pageWidth - margin * 2;
    const drawHeight = drawWidth * (page.height / page.width);
    const y = pageHeight - margin - drawHeight;
    const commands = `q\n${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${margin} ${y.toFixed(2)} cm\n/Im1 Do\nQ`;
    const imageBytes = base64ToBinary(page.dataUrl.split(',')[1] || '');
    objects.push({ body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /ProcSet [/PDF /ImageC] /XObject << /Im1 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>` });
    objects.push({
      prefix: `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`,
      bytes: imageBytes,
      suffix: '\nendstream'
    });
    objects.push({ body: `<< /Length ${commands.length} >>\nstream\n${commands}\nendstream` });
  });

  objects[1] = { body: `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pageRefs.length} >>` };
  const encoder = new TextEncoder();
  const parts = [];
  const offsets = [0];
  let length = 0;
  const addString = text => {
    const bytes = encoder.encode(text);
    parts.push(bytes);
    length += bytes.length;
  };
  const addBytes = bytes => {
    parts.push(bytes);
    length += bytes.length;
  };

  addString('%PDF-1.4\n');
  objects.forEach((object, index) => {
    offsets.push(length);
    addString(`${index + 1} 0 obj\n`);
    if (object.body !== undefined) {
      addString(object.body);
    } else {
      addString(object.prefix);
      addBytes(object.bytes);
      addString(object.suffix);
    }
    addString('\nendobj\n');
  });
  const xref = length;
  addString(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= objects.length; i += 1) addString(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  addString(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);

  const pdf = new Uint8Array(length);
  let offset = 0;
  parts.forEach(part => {
    pdf.set(part, offset);
    offset += part.length;
  });
  return pdf;
}

async function downloadDashboardSnapshotPdf(element, filename) {
  if (!element) return;
  const canvas = await html2canvas(element, {
    backgroundColor: '#F7F8FC',
    scale: Math.max(4, window.devicePixelRatio || 1),
    useCORS: true,
    ignoreElements: node => node?.dataset?.exportHidden === 'true'
  });

  const pageWidth = 792;
  const pageHeight = 612;
  const margin = 22;
  const drawableWidth = pageWidth - margin * 2;
  const drawableHeight = pageHeight - margin * 2;
  const sourcePageHeight = Math.floor(canvas.width * (drawableHeight / drawableWidth));
  const pages = [];
  for (let sourceY = 0; sourceY < canvas.height; sourceY += sourcePageHeight) {
    const sliceHeight = Math.min(sourcePageHeight, canvas.height - sourceY);
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceHeight;
    const pageContext = pageCanvas.getContext('2d');
    pageContext.fillStyle = '#F7F8FC';
    pageContext.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    pageContext.drawImage(canvas, 0, sourceY, canvas.width, sliceHeight, 0, 0, pageCanvas.width, pageCanvas.height);
    pages.push({ width: pageCanvas.width, height: pageCanvas.height, dataUrl: pageCanvas.toDataURL('image/jpeg', 0.98) });
  }

  downloadTextFile(filename, buildImagePdf(pages), 'application/pdf');
}

function pdfEscape(value) {
  return String(value ?? '').replace(/[^\x20-\x7E]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function truncatePdfCell(value, length) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, Math.max(length - 3, 1))}...` : text;
}

function wrapPdfCell(value, maxChars, maxLines = 2) {
  const text = String(value ?? '').replace(/[^\x20-\x7E]/g, '?').replace(/\s+/g, ' ').trim();
  if (!text) return [''];
  const words = text.split(' ');
  const lines = [];
  let current = '';
  words.forEach(word => {
    if (word.length > maxChars) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars));
      return;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const clipped = lines.slice(0, maxLines);
    clipped[maxLines - 1] = `${clipped[maxLines - 1].slice(0, Math.max(maxChars - 3, 1))}...`;
    return clipped;
  }
  return lines.length ? lines : ['N/A'];
}

function pdfText(x, y, text, size = 8, font = 'F1', color = '0.10 0.13 0.20') {
  return `BT /${font} ${size} Tf ${color} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfEscape(text)}) Tj ET`;
}

function pdfRect(x, y, width, height, fill = null, stroke = null) {
  const commands = [];
  if (fill) commands.push(`${fill} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
  if (stroke) commands.push(`${stroke} RG 0.5 w ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`);
  return commands.join('\n');
}

function pdfLine(x1, y1, x2, y2, color = '0.88 0.90 0.94') {
  return `${color} RG 0.5 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`;
}

function buildPdfDocument(objects) {
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

function downloadTablePdf(filename, title, subtitle, columns, rows) {
  const pageWidth = 792;
  const pageHeight = 612;
  const margin = 34;
  const tableWidth = pageWidth - margin * 2;
  const headerHeight = 76;
  const footerHeight = 28;
  const tableHeaderHeight = 24;
  const rowBaseHeight = 24;
  const lineHeight = 10;
  const weights = columns.map(column => Math.max(110, String(column || '').length * 16));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const sizedColumns = columns.map((column, index) => ({
    label: column,
    width: tableWidth * (weights[index] / totalWeight)
  }));
  const preparedRows = rows.map(row => {
    const cells = sizedColumns.map((column, index) => wrapPdfCell(row[index], Math.max(8, Math.floor((column.width - 12) / 4.4)), 2));
    const maxLines = Math.max(...cells.map(cell => cell.length), 1);
    return { cells, height: Math.max(rowBaseHeight, 12 + maxLines * lineHeight) };
  });
  if (preparedRows.length === 0) preparedRows.push({ cells: [wrapPdfCell('No entries match the current filters.', 60, 1)], height: rowBaseHeight });

  const pages = [];
  let currentPage = [];
  let y = pageHeight - margin - headerHeight - tableHeaderHeight;
  preparedRows.forEach(row => {
    if (currentPage.length && y - row.height < margin + footerHeight) {
      pages.push(currentPage);
      currentPage = [];
      y = pageHeight - margin - headerHeight - tableHeaderHeight;
    }
    currentPage.push(row);
    y -= row.height;
  });
  if (currentPage.length) pages.push(currentPage);

  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];
  const pageRefs = [];
  pages.forEach((pageRows, pageIndex) => {
    const pageId = objects.length + 1;
    const contentId = objects.length + 2;
    pageRefs.push(`${pageId} 0 R`);
    const commands = [];
    commands.push(pdfRect(0, pageHeight - 58, pageWidth, 58, '0.01 0.22 0.63'));
    commands.push(pdfText(margin, pageHeight - 32, title, 18, 'F2', '1 1 1'));
    commands.push(pdfText(margin, pageHeight - 49, subtitle || `${rows.length} entries`, 9, 'F1', '0.86 0.92 1'));
    commands.push(pdfText(pageWidth - 182, pageHeight - 49, `Exported ${new Date().toLocaleString()}`, 8, 'F1', '0.86 0.92 1'));

    let x = margin;
    const headerY = pageHeight - margin - headerHeight;
    commands.push(pdfRect(margin, headerY, tableWidth, tableHeaderHeight, '0.94 0.97 1', '0.78 0.84 0.92'));
    sizedColumns.forEach(column => {
      commands.push(pdfText(x + 6, headerY + 8, column.label, 8, 'F2', '0.10 0.20 0.42'));
      commands.push(pdfLine(x + column.width, headerY, x + column.width, headerY + tableHeaderHeight, '0.78 0.84 0.92'));
      x += column.width;
    });

    let rowY = headerY;
    pageRows.forEach((row, rowIndex) => {
      rowY -= row.height;
      commands.push(pdfRect(margin, rowY, tableWidth, row.height, rowIndex % 2 === 0 ? '1 1 1' : '0.98 0.99 1', '0.88 0.90 0.94'));
      let cellX = margin;
      row.cells.forEach((cellLines, cellIndex) => {
        cellLines.forEach((line, lineIndex) => {
          commands.push(pdfText(cellX + 6, rowY + row.height - 14 - lineIndex * lineHeight, line, 7.5, cellIndex === 0 ? 'F2' : 'F1', cellIndex === 0 ? '0.01 0.22 0.63' : '0.10 0.13 0.20'));
        });
        commands.push(pdfLine(cellX + sizedColumns[cellIndex].width, rowY, cellX + sizedColumns[cellIndex].width, rowY + row.height, '0.91 0.93 0.96'));
        cellX += sizedColumns[cellIndex].width;
      });
    });

    commands.push(pdfLine(margin, margin + footerHeight, pageWidth - margin, margin + footerHeight, '0.78 0.84 0.92'));
    commands.push(pdfText(margin, margin + 10, `${rows.length} entries`, 8, 'F1', '0.38 0.43 0.52'));
    commands.push(pdfText(pageWidth - 92, margin + 10, `Page ${pageIndex + 1} of ${pages.length}`, 8, 'F1', '0.38 0.43 0.52'));
    const content = commands.filter(Boolean).join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pages.length} >>`;
  downloadTextFile(filename, buildPdfDocument(objects), 'application/pdf');
}

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function openPrintableTable({ title, subtitle, columns, rows }) {
  const popup = window.open('', '_blank', 'width=1100,height=800');
  if (!popup) return;
  popup.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${htmlEscape(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111827; padding: 24px; }
          h1 { font-size: 22px; margin: 0 0 4px; }
          p { color: #4B5563; margin: 0 0 18px; }
          table { border-collapse: collapse; width: 100%; font-size: 12px; }
          th, td { border: 1px solid #D1D5DB; padding: 7px 8px; text-align: left; vertical-align: top; }
          th { background: #F3F4F6; color: #374151; }
          @page { margin: 0.45in; }
        </style>
      </head>
      <body>
        <h1>${htmlEscape(title)}</h1>
        ${subtitle ? `<p>${htmlEscape(subtitle)}</p>` : ''}
        <table>
          <thead><tr>${columns.map(column => `<th>${htmlEscape(column)}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.map(row => `<tr>${row.map(cell => `<td>${htmlEscape(cell)}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </body>
    </html>
  `);
  popup.document.close();
  popup.focus();
  popup.print();
}

function DashboardPdfButton({ onPdf, disabled }) {
  return (
    <button type="button" className="btn-secondary" onClick={onPdf} disabled={disabled} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}>
      <Printer size={14} />
      {disabled ? 'Exporting...' : 'PDF'}
    </button>
  );
}

function polarToCartesian(cx, cy, radius, angleInDegrees) {
  const angleInRadians = (angleInDegrees - 90) * Math.PI / 180;
  return {
    x: cx + (radius * Math.cos(angleInRadians)),
    y: cy + (radius * Math.sin(angleInRadians))
  };
}

function donutSegmentPath(cx, cy, outerRadius, innerRadius, startAngle, endAngle) {
  const outerStart = polarToCartesian(cx, cy, outerRadius, endAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, startAngle);
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${innerEnd.x} ${innerEnd.y}`,
    'Z'
  ].join(' ');
}

function Dashboard({ syncing, runSync, canRunSync, integrationMeta }) {
  const navigate = useNavigate();
  const { integration } = useParams();
  const dashboardRef = useRef(null);
  const [data, setData] = useState(null);
  const [integrationDef, setIntegrationDef] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer = null;
    const cachedDashboard = dashboardCache.get(integration) || null;
    const cachedIntegration = integrationDefCache.get(integration) || integrationMeta || null;

    if (integrationMeta) {
      integrationDefCache.set(integration, integrationMeta);
    }

    setData(cachedDashboard);
    setIntegrationDef(cachedIntegration);
    setLoading(!(cachedDashboard && cachedIntegration));

    const loadDashboard = async (retry = true) => {
      if (!dashboardCache.has(integration) || !integrationDefCache.has(integration)) setLoading(true);
      setError('');
      try {
        const dashboardPromise = fetch(`/api/dashboard?integration=${integration}`);
        const integrationPromise = cachedIntegration
          ? Promise.resolve(cachedIntegration)
          : fetch(`/api/marketplace/${integration}`)
              .then(async response => {
                const json = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(json.error || 'Unable to load integration display definition.');
                return json;
              });
        const [dashboardResponse, integrationJson] = await Promise.all([dashboardPromise, integrationPromise]);
        const dashboardJson = await dashboardResponse.json().catch(() => ({}));
        if (!dashboardResponse.ok) throw new Error(dashboardJson.error || 'Unable to load dashboard.');
        if (!cancelled) {
          dashboardCache.set(integration, dashboardJson);
          integrationDefCache.set(integration, integrationJson);
          setData(dashboardJson);
          setIntegrationDef(integrationJson);
          if (dashboardJson.status === 'Running') {
            refreshTimer = window.setTimeout(() => loadDashboard(false), 15000);
          }
        }
      } catch (loadError) {
        if (retry && !cancelled) {
          window.setTimeout(() => loadDashboard(false), 600);
          return;
        }
        if (!cancelled) setError(loadError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadDashboard();
    return () => {
      cancelled = true;
      if (refreshTimer) window.clearTimeout(refreshTimer);
    };
  }, [integration, syncing, integrationMeta]);


  if (loading) return <div style={{ padding: '2rem' }}>Loading Dashboard...</div>;
  if (error) {
    return (
      <div className="glass-panel" style={{ borderLeft: '4px solid #ef4444', background: '#FEF2F2' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <AlertTriangle color="#ef4444" size={20} />
          <strong style={{ color: '#991B1B' }}>Unable to load dashboard</strong>
        </div>
        <p style={{ margin: '0.4rem 0 0 1.75rem', fontSize: '0.85rem', color: '#B91C1C' }}>{error}</p>
      </div>
    );
  }

  const stats = data?.stats || {};
  const integrationName = integrationDef?.name || integration.charAt(0).toUpperCase() + integration.slice(1);
  const dashboard = defaultDashboard;
  const kpis = Array.isArray(dashboard.kpis) ? dashboard.kpis : [];
  const sections = Array.isArray(dashboard.sections) ? dashboard.sections : [];
  const isRunning = syncing || data?.status === 'Running';
  const hasCompletedMetrics = Boolean(data?.stats);
  const runningAgeMinutes = Math.floor((data?.runningAgeSeconds || 0) / 60);
  const runningTitle = hasCompletedMetrics ? 'Sync is running' : 'Initial sync is running';
  const runningMessage = hasCompletedMetrics
    ? 'Existing dashboard metrics remain visible while the latest sync finishes. This page will refresh periodically.'
    : runningAgeMinutes >= 30
      ? 'This sync is still working through vulnerability scoring data. Large NIST lookups can take a while, especially when several integrations are synced at the same time.'
      : 'Dashboard metrics will fill in after this sync writes endpoint, vulnerability, and scoring data. This page will refresh periodically.';
  const isInterrupted = data?.status === 'Interrupted' || String(data?.details || '').includes('Marketplace restarted while this sync was running');
  const alertTitle = isInterrupted ? 'Previous Sync Was Interrupted' : 'Operational Alert: Last Synchronization Failed';
  const alertColor = isInterrupted ? '#92400E' : '#991B1B';
  const alertBackground = isInterrupted ? '#FFFBEB' : '#FEF2F2';
  const alertBorder = isInterrupted ? '#f59e0b' : '#ef4444';
  const alertMessageColor = isInterrupted ? '#B45309' : '#B91C1C';
  const pieData = [
    { name: 'Critical', value: stats.totalCritical || 0, color: '#ef4444' },
    { name: 'High', value: stats.totalHigh || 0, color: '#f97316' },
    { name: 'Medium', value: stats.totalMedium || 0, color: '#eab308' },
    { name: 'Low', value: stats.totalLow || 0, color: '#3b82f6' }
  ];
  const hasSeverityData = pieData.some(item => item.value > 0);
  const totalSeverity = pieData.reduce((sum, item) => sum + item.value, 0);
  let chartAngle = 0;
  const donutSegments = pieData
    .filter(item => item.value > 0)
    .map(item => {
      const startAngle = chartAngle;
      const endAngle = chartAngle + (item.value / totalSeverity) * 360;
      chartAngle = endAngle;
      return { ...item, startAngle, endAngle };
    });

  const exportDashboardPdf = async () => {
    setExportingPdf(true);
    try {
      await downloadDashboardSnapshotPdf(dashboardRef.current, `${safeFileName(integrationName)}-dashboard-${exportDateStamp()}.pdf`);
    } finally {
      setExportingPdf(false);
    }
  };

  const Card = ({ card }) => {
    const Icon = iconMap[card.icon];
    const value = metricValue(card.metric, stats);
    return (
      <div
        className="stat-card glass-panel"
        style={{ borderTop: `4px solid ${card.color || '#1D8EE6'}`, cursor: 'pointer', transition: 'transform 0.12s' }}
        onClick={() => navigate(targetPath(integration, card.to))}
        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
      >
        {Icon && <Icon className="card-icon" size={48} />}
        <h3>{tokenText(card.label, integrationName)}</h3>
        <div className="value" style={{ color: card.color || '#1D8EE6' }}>{value ?? 0}</div>
        {card.subtitle && <div className="subtitle">{tokenText(card.subtitle, integrationName)}</div>}
      </div>
    );
  };

  const Section = ({ title, children }) => (
    <div className="dashboard-section">
      <div className="section-header">
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );

  const renderCards = (section) => (
    <div className="dashboard-grid" style={section.columns ? { gridTemplateColumns: `repeat(${section.columns}, 1fr)` } : undefined}>
      {(section.cards || []).map((card, index) => <Card key={`${card.label}-${index}`} card={card} />)}
    </div>
  );

  const renderDistribution = ({ showTitle = true } = {}) => (
    <div className="glass-panel" style={{ minHeight: '260px', display: 'flex', flexDirection: 'column', padding: '1rem' }}>
      {showTitle && <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 700 }}>Distribution</h3>}
      <div style={{ height: '240px', minHeight: '240px' }}>
        {hasSeverityData ? (
          <svg viewBox="0 0 260 220" width="100%" height="100%" role="img" aria-label="Severity distribution">
            <g transform="translate(20 0)">
              {donutSegments.map(segment => (
                <path
                  key={segment.name}
                  d={donutSegmentPath(110, 110, 86, 58, segment.startAngle, segment.endAngle)}
                  fill={segment.color}
                  stroke="#fff"
                  strokeWidth="4"
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/apps/${integration}/vulnerabilities?severity=${segment.name}`)}
                >
                  <title>{`${segment.name}: ${segment.value}`}</title>
                </path>
              ))}
              <circle cx="110" cy="110" r="52" fill="#fff" />
              <text x="110" y="105" textAnchor="middle" style={{ fontSize: '24px', fontWeight: 800, fill: 'var(--text-primary)' }}>{totalSeverity}</text>
              <text x="110" y="124" textAnchor="middle" style={{ fontSize: '11px', fontWeight: 700, fill: 'var(--text-secondary)' }}>CVEs</text>
            </g>
          </svg>
        ) : (
          <div style={{ height: '100%', minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: '#9CA3AF', fontSize: '0.85rem', padding: '1rem' }}>
            {hasCompletedMetrics ? 'No severity data was reported in the latest successful sync.' : 'Severity distribution will appear after the first successful sync.'}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
        {pieData.map(d => (
          <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: d.color }} /> {d.name}
          </div>
        ))}
      </div>
    </div>
  );

  const renderSection = (section, index) => {
    if (section.type === 'severityDistribution') {
      return (
        <Section key={index} title={tokenText(section.title, integrationName)}>
          {renderDistribution({ showTitle: false })}
        </Section>
      );
    }

    if (section.layout === 'severity-with-distribution') {
      return (
        <Section key={index} title={tokenText(section.title, integrationName)}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 340px)', gap: '1.25rem', alignItems: 'stretch' }}>
            <div className="dashboard-grid">
              {(section.cards || []).map((card, cardIndex) => <Card key={`${card.label}-${cardIndex}`} card={card} />)}
            </div>
            {renderDistribution()}
          </div>
        </Section>
      );
    }

    return (
      <Section key={index} title={tokenText(section.title, integrationName)}>
        {renderCards(section)}
      </Section>
    );
  };

  return (
    <div className="dashboard-container" ref={dashboardRef}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1rem' }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: '0.25rem' }}>{tokenText(dashboard.title, integrationName)}</h1>
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.9rem' }}>{tokenText(dashboard.description, integrationName)}</p>
        </div>
        <div style={{ textAlign: 'right', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <span data-export-hidden="true">
            <DashboardPdfButton onPdf={exportDashboardPdf} disabled={exportingPdf} />
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-light)', background: '#fff', padding: '0.4rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
            <Calendar size={14} />
            Last Synced: {data?.lastRun ? new Date(data.lastRun).toLocaleString() : 'Never'}
          </div>
          {canRunSync && (
            <button className="btn-primary" onClick={runSync} disabled={isRunning} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 1rem', fontSize: '0.85rem' }}>
              <RefreshCw size={14} style={{ animation: isRunning ? 'spin 1s linear infinite' : 'none' }} />
              {isRunning ? 'Syncing...' : 'Run Sync Now'}
            </button>
          )}
        </div>
      </div>

      {isRunning && !hasCompletedMetrics && (
        <div className="glass-panel" style={{ borderLeft: '4px solid #1D8EE6', background: '#EFF6FF' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <RefreshCw color="#1D8EE6" size={20} style={{ animation: 'spin 1s linear infinite' }} />
            <strong style={{ color: '#1E3A8A' }}>{runningTitle}</strong>
          </div>
          <p style={{ margin: '0.4rem 0 0 1.75rem', fontSize: '0.85rem', color: '#1D4ED8' }}>
            {runningMessage}
          </p>
        </div>
      )}

      {(data?.status === 'Failed' || data?.status === 'Interrupted') && (
        <div className="glass-panel" style={{ borderLeft: `4px solid ${alertBorder}`, background: alertBackground }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <AlertTriangle color={alertBorder} size={20} />
            <strong style={{ color: alertColor }}>{alertTitle}</strong>
          </div>
          <p style={{ margin: '0.4rem 0 0 1.75rem', fontSize: '0.85rem', color: alertMessageColor }}>{compactSyncDetails(data?.details)}</p>
        </div>
      )}

      {kpis.length > 0 && (
        <div className="dashboard-grid" style={{ gridTemplateColumns: `repeat(${kpis.length}, 1fr)` }}>
          {kpis.map((kpi, index) => (
            <div
              key={`${kpi.label}-${index}`}
              className="glass-panel"
              onClick={() => kpi.to && navigate(targetPath(integration, kpi.to))}
              style={{ textAlign: 'center', background: '#fff', cursor: kpi.to ? 'pointer' : 'default' }}
            >
              <div style={{ color: kpi.color || 'var(--text-primary)', fontWeight: 700, fontSize: '1.75rem' }}>{metricValue(kpi.metric, stats)}{String(kpi.metric || '').toLowerCase().includes('rate') ? '%' : ''}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{tokenText(kpi.label, integrationName)}</div>
            </div>
          ))}
        </div>
      )}

      {sections.map(renderSection)}
    </div>
  );
}

export default Dashboard;



