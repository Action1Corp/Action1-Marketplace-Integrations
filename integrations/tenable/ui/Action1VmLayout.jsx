import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  Download,
  RefreshCw,
  Search,
  X
} from 'lucide-react';

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 250];

const colors = {
  blue: '#0337A1',
  blueHover: '#1D59D3',
  activeBlue: '#B6D9FC',
  activeHover: '#E7F2FE',
  activeBorder: '#1A4FBC',
  page: '#F7F7F7',
  border: '#D4D4D4',
  muted: '#8A8A8A',
  text: '#090A0B',
  icon: '#B6D9FC',
  header: '#757575',
  green: '#60AC39',
  yellow: '#FFD84D',
  red: '#E33B3B',
  pale: '#FFFFFF',
  disabled: '#D4D4D4',
  disabledText: '#757575'
};

const fontFamily = 'RooftopBook, Helvetica, Arial, sans-serif';

const button = {
  border: `1px solid ${colors.activeBorder}`,
  borderRadius: 6,
  padding: '0 20px',
  fontSize: 13,
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.35rem',
  minHeight: 44,
  fontFamily
};

const blueButton = {
  ...button,
  color: '#fff',
  background: colors.blue
};

const disabledButton = {
  ...button,
  color: colors.disabledText,
  background: colors.disabled,
  borderColor: colors.disabled
};

const filterButton = {
  ...button,
  color: colors.text,
  background: '#fff',
  borderColor: colors.border,
  fontWeight: 500,
  minWidth: 158,
  justifyContent: 'space-between'
};

const tabIcon = {
  general: 'info',
  endpoints: 'endpoints',
  vulnerableSoftware: 'software',
  details: 'info',
  vulnerabilities: 'vulnerabilities',
  installedSoftware: 'software'
};

const action1IconPaths = {
  info: {
    viewBox: '0 0 512 512',
    paths: ['M256 8C119.04 8 8 119.08 8 256s111.04 248 248 248 248-111.08 248-248S392.96 8 256 8zm0 110c23.2 0 42 18.8 42 42s-18.8 42-42 42-42-18.8-42-42 18.8-42 42-42zm56 254c0 6.6-5.4 12-12 12h-88c-6.6 0-12-5.4-12-12v-24c0-6.6 5.4-12 12-12h12v-64h-12c-6.6 0-12-5.4-12-12v-24c0-6.6 5.4-12 12-12h64c6.6 0 12 5.4 12 12v100h12c6.6 0 12 5.4 12 12v24z']
  },
  endpoints: {
    viewBox: '0 0 640 512',
    paths: ['M128 96h384v256h64V64c0-35.3-28.7-64-64-64H128C92.7 0 64 28.7 64 64v288h64V96zm480 288H32c-17.7 0-32 14.3-32 32v32c0 35.3 28.7 64 64 64h512c35.3 0 64-28.7 64-64v-32c0-17.7-14.3-32-32-32z']
  },
  vulnerabilities: {
    viewBox: '0 0 576 512',
    paths: ['M192 96c0-53 43-96 96-96s96 43 96 96l0 3.6c0 15.7-12.7 28.4-28.4 28.4l-135.1 0c-15.7 0-28.4-12.7-28.4-28.4l0-3.6zm345.6 12.8c10.6 14.1 7.7 34.2-6.4 44.8l-97.8 73.3c5.3 8.9 9.3 18.7 11.8 29.1l98.8 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-96 0 0 32c0 2.6-.1 5.3-.2 7.9l83.4 62.5c14.1 10.6 17 30.7 6.4 44.8s-30.7 17-44.8 6.4l-63.1-47.3c-23.2 44.2-66.5 76.2-117.7 83.9L312 280c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 230.2c-51.2-7.7-94.5-39.7-117.7-83.9L83.2 473.6c-14.1 10.6-34.2 7.7-44.8-6.4s-7.7-34.2 6.4-44.8l83.4-62.5c-.1-2.6-.2-5.2-.2-7.9l0-32-96 0c-17.7 0-32-14.3-32-32s14.3-32 32-32l98.8 0c2.5-10.4 6.5-20.2 11.8-29.1L44.8 153.6c-14.1-10.6-17-30.7-6.4-44.8s30.7-17 44.8-6.4L192 184c12.3-5.1 25.8-8 40-8l112 0c14.2 0 27.7 2.8 40 8l108.8-81.6c14.1-10.6 34.2-7.7 44.8 6.4z']
  },
  software: {
    viewBox: '0 0 18 18',
    paths: ['M2 2h4v4H2V2zm5 0h4v4H7V2zm5 0h4v4h-4V2zM2 7h4v4H2V7zm5 0h4v4H7V7zm5 0h4v4h-4V7zM2 12h4v4H2v-4zm5 0h4v4H7v-4zm5 0h4v4h-4v-4z']
  }
};

function Action1PanelIcon({ type, selected = false, size = 16 }) {
  const icon = action1IconPaths[type] || action1IconPaths.info;
  return (
    <svg
      width={size}
      height={size}
      viewBox={icon.viewBox}
      aria-hidden="true"
      style={{ color: selected ? colors.blue : colors.icon, fill: icon.stroke ? 'none' : 'currentColor', stroke: icon.stroke ? 'currentColor' : 'none', strokeWidth: icon.stroke ? 2 : undefined, strokeLinecap: icon.stroke ? 'round' : undefined, strokeLinejoin: icon.stroke ? 'round' : undefined, flex: '0 0 auto' }}
    >
      {icon.paths.map((path, index) => <path key={index} d={path} />)}
    </svg>
  );
}

function tokenText(value, integrationName) {
  return String(value || '').replaceAll('{integrationName}', integrationName);
}

function titleCase(value) {
  return String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
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

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function exportCellValue(row, column) {
  if (column.exportValue) return column.exportValue(row);
  if (column.value) return column.value(row);
  const value = row[column.key];
  if (value === null || value === undefined || value === '') return 'N/A';
  return value;
}

function downloadRowsCsv(filename, columns, rows) {
  const csv = [
    columns.map(column => csvEscape(column.label)).join(','),
    ...rows.map(row => columns.map(column => csvEscape(exportCellValue(row, column))).join(','))
  ].join('\r\n');
  downloadTextFile(filename, csv, 'text/csv;charset=utf-8');
}

function pdfEscape(value) {
  return String(value ?? '').replace(/[^\x20-\x7E]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function truncatePdfCell(value, length) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, Math.max(length - 3, 1))}...` : text;
}

function wrapPdfCell(value, maxChars, maxLines = 2) {
  const text = String(value ?? 'N/A').replace(/[^\x20-\x7E]/g, '?').replace(/\s+/g, ' ').trim() || 'N/A';
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

function downloadRowsPdf(filename, title, subtitle, columns, rows) {
  const pageWidth = 792;
  const pageHeight = 612;
  const margin = 34;
  const tableWidth = pageWidth - margin * 2;
  const headerHeight = 76;
  const footerHeight = 28;
  const tableHeaderHeight = 24;
  const rowBaseHeight = 24;
  const lineHeight = 10;
  const pdfColumns = columns.map(column => ({
    label: column.label,
    weight: column.width || Math.max(110, String(column.label || '').length * 12),
    value: row => exportCellValue(row, column)
  }));
  const totalWeight = pdfColumns.reduce((sum, column) => sum + column.weight, 0) || 1;
  const sizedColumns = pdfColumns.map(column => ({ ...column, width: tableWidth * (column.weight / totalWeight) }));
  const preparedRows = rows.map(row => {
    const cells = sizedColumns.map(column => wrapPdfCell(column.value(row), Math.max(8, Math.floor((column.width - 12) / 4.4)), 2));
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

function openPrintWindow(title = 'Preparing export') {
  const popup = window.open('', '_blank', 'width=1100,height=800');
  if (!popup) return null;
  popup.document.write(`
    <!doctype html>
    <html>
      <head><title>${htmlEscape(title)}</title></head>
      <body style="font-family: Arial, sans-serif; padding: 24px; color: #090A0B;">
        <h1 style="font-size: 20px;">Preparing PDF export...</h1>
        <p style="color: #8A8A8A;">Collecting rows for the report.</p>
      </body>
    </html>
  `);
  popup.document.close();
  return popup;
}

function openPrintableRows({ title, subtitle, columns, rows, popup: existingPopup = null }) {
  const popup = existingPopup || openPrintWindow(title);
  if (!popup) return;
  popup.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${htmlEscape(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #090A0B; padding: 24px; }
          h1 { font-size: 22px; margin: 0 0 4px; }
          p { color: #8A8A8A; margin: 0 0 18px; }
          table { border-collapse: collapse; width: 100%; font-size: 11px; }
          th, td { border: 1px solid #D4D4D4; padding: 6px 7px; text-align: left; vertical-align: top; }
          th { background: #F7F7F7; color: #090A0B; }
          @page { margin: 0.4in; }
        </style>
      </head>
      <body>
        <h1>${htmlEscape(title)}</h1>
        ${subtitle ? `<p>${htmlEscape(subtitle)}</p>` : ''}
        <table>
          <thead><tr>${columns.map(column => `<th>${htmlEscape(column.label)}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.map(row => `<tr>${columns.map(column => `<td>${htmlEscape(exportCellValue(row, column))}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </body>
    </html>
  `);
  popup.document.close();
  popup.focus();
  popup.print();
}

async function fetchAllListRows(apiPath, params, expectedTotal) {
  const allRows = [];
  const pageSize = 250;
  let page = 1;
  let total = expectedTotal || 0;
  while (page <= 400) {
    const exportParams = new URLSearchParams(params);
    exportParams.set('page', String(page));
    exportParams.set('pageSize', String(pageSize));
    const response = await fetch(`${apiPath}?${exportParams.toString()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to export rows.');
    const pageRows = data.rows || [];
    total = data.total || total;
    allRows.push(...pageRows);
    if (pageRows.length === 0 || allRows.length >= total) break;
    page += 1;
  }
  return allRows;
}

function ExportButtons({ onCsv, disabled }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', padding: '0.75rem 0' }}>
      <button type="button" onClick={onCsv} disabled={disabled} style={disabled ? disabledButton : blueButton}>
        <Download size={14} />
        CSV
      </button>
    </div>
  );
}

function SeverityDot({ value }) {
  const numeric = Number(value);
  const color = Number.isFinite(numeric)
    ? numeric >= 9 ? colors.red : numeric >= 7 ? colors.yellow : '#B7D6F0'
    : String(value || '').toLowerCase() === 'critical' ? colors.red
      : String(value || '').toLowerCase() === 'high' ? colors.yellow
        : '#B7D6F0';
  return <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: color, marginRight: 6, verticalAlign: -1 }} />;
}

function remediationStatusColor(value) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'patch available') return colors.green;
  if (status === 'non patchable') return colors.red;
  if (status.includes('not recognized') || status.includes('unavailable') || status.includes('missing') || status.includes('failed')) return colors.red;
  return colors.yellow;
}

function StatusDot({ value }) {
  return <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: remediationStatusColor(value), marginRight: 6, verticalAlign: -1 }} />;
}

function RemediationStatus({ value }) {
  const label = value || 'N/A';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', color: colors.text }}>
      <StatusDot value={label} />
      {label}
    </span>
  );
}

function CveLink({ value, onSelect }) {
  const cve = String(value || '').trim();
  if (!cve) return 'N/A';
  if (onSelect) {
    return (
      <button
        type="button"
        onClick={event => {
          event.stopPropagation();
          onSelect();
        }}
        style={{ color: colors.blue, fontWeight: 500, textDecoration: 'none', background: 'transparent', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }}
      >
        {cve}
      </button>
    );
  }
  return (
    <a
      href={`https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cve)}`}
      target="_blank"
      rel="noreferrer"
      onClick={event => event.stopPropagation()}
      style={{ color: colors.blue, fontWeight: 500, textDecoration: 'none' }}
    >
      {cve}
    </a>
  );
}

function isTextSelectionActive() {
  return Boolean(window.getSelection?.()?.toString().trim());
}

function formatCvssScore(value) {
  const score = Number.parseFloat(value);
  return Number.isFinite(score) ? score.toFixed(1) : 'N/A';
}

function CvssScore({ score, severity }) {
  const displayScore = formatCvssScore(score);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', color: colors.text }}>
      <SeverityDot value={displayScore !== 'N/A' ? displayScore : severity} />
      {displayScore}
    </span>
  );
}

function ActionButton({ children, disabled = false }) {
  return <button type="button" style={disabled ? disabledButton : blueButton}>{children}</button>;
}

function FilterButton({ children }) {
  return <button type="button" style={filterButton}>{children}<span style={{ color: colors.muted }}>v</span></button>;
}

function SearchInput({ value, onChange, width = 260 }) {
  return (
    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <Search size={17} style={{ position: 'absolute', left: 12, color: '#7B8496' }} />
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder="Search..."
        style={{
          width,
          height: 34,
          border: '1px solid #B8C0CF',
          borderRadius: 4,
          padding: '0 0.8rem 0 2.25rem',
          fontSize: 13,
          outline: 'none',
          color: colors.text,
          fontFamily
        }}
      />
    </label>
  );
}

function Pager({ page, total, pageSize, onPageChange, onPageSizeChange }) {
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.65rem 1rem', color: colors.text, fontFamily, fontSize: 13 }}>
      <button style={disabledButton} disabled={page <= 1} onClick={() => onPageChange(1)}>{'<<'}</button>
      <button style={disabledButton} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>{'<'}</button>
      <button style={{ ...button, background: colors.activeBlue, color: colors.blue, borderColor: colors.activeBlue, minWidth: 32, justifyContent: 'center' }}>{page}</button>
      <button style={disabledButton} disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>{'>'}</button>
      <button style={disabledButton} disabled={page >= totalPages} onClick={() => onPageChange(totalPages)}>{'>>'}</button>
      <span style={{ marginLeft: 10 }}>{start} - {end} of {total}</span>
      <select
        value={pageSize}
        onChange={event => onPageSizeChange(Number(event.target.value))}
        style={{ ...filterButton, minWidth: 72, height: 32, justifyContent: 'center', padding: '0 8px' }}
      >
        {PAGE_SIZE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  );
}

function PanelTabs({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', borderBottom: `1px solid ${colors.border}`, background: '#FBFCFE', fontFamily }}>
      {tabs.map(tab => {
        const iconType = tabIcon[tab.id] || 'info';
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            style={{
              minWidth: 150,
              height: 39,
              border: 0,
              borderRight: `1px solid ${colors.border}`,
              borderTop: selected ? `2px solid ${colors.blue}` : '2px solid transparent',
              background: selected ? '#fff' : '#FBFCFE',
              color: selected ? colors.blue : colors.text,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontWeight: selected ? 600 : 500,
              fontSize: 13,
              fontFamily
            }}
          >
            <Action1PanelIcon type={iconType} selected={selected} size={16} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function DetailShell({ title, summary, tabs, activeTab, setActiveTab, children, onClose, onRefresh, panelRef }) {
  return (
    <div ref={panelRef} style={{ marginTop: 14, background: '#fff', borderTop: `1px solid ${colors.border}`, boxShadow: '0 -1px 0 #D7DEE9', fontFamily }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.62rem 1rem', borderBottom: `1px solid ${colors.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, color: colors.text }}>
          <strong style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}>{title}</strong>
          <span style={{ color: colors.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{summary}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button title="Refresh" type="button" onClick={onRefresh} style={iconButton}><RefreshCw size={17} /></button>
          <button title="Close" type="button" onClick={onClose} style={iconButton}><X size={18} /></button>
        </div>
      </div>
      <PanelTabs tabs={tabs} active={activeTab} onChange={setActiveTab} />
      <div style={{ minHeight: 260, padding: '0.9rem 1.2rem' }}>
        {children}
      </div>
    </div>
  );
}

const iconButton = {
  width: 32,
  height: 32,
  border: `1px solid ${colors.blue}`,
  borderRadius: 4,
  color: colors.blue,
  background: '#fff',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center'
};

function KeyValueRows({ rows }) {
  return (
    <table style={{ borderCollapse: 'collapse', minWidth: 560, fontFamily, fontSize: 13 }}>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td style={{ width: 235, padding: '0.5rem 0', fontWeight: 600, color: colors.text }}>{label}:</td>
            <td style={{ padding: '0.5rem 0', color: colors.text }}>{value || 'N/A'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MiniTable({ columns, rows, emptyText, defaultFilters = {}, exportTitle = 'List' }) {
  const [sortConfig, setSortConfig] = useState({ key: columns[0]?.key || '', direction: 'asc' });
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const getColumnValue = (row, column) => {
    const value = column.value ? column.value(row) : row[column.key];
    if (value === null || value === undefined) return '';
    return String(value);
  };

  const filteredRows = useMemo(() => {
    const activeFilters = Object.entries(filters).filter(([, value]) => String(value || '').trim());
    let nextRows = [...(rows || [])];

    if (activeFilters.length > 0) {
      nextRows = nextRows.filter(row => activeFilters.every(([key, value]) => {
        const column = columns.find(item => item.key === key);
        if (!column) return true;
        return getColumnValue(row, column).toLowerCase().includes(String(value).toLowerCase());
      }));
    }

    if (sortConfig.key) {
      const column = columns.find(item => item.key === sortConfig.key);
      if (column) {
        nextRows.sort((a, b) => {
          const aValue = getColumnValue(a, column);
          const bValue = getColumnValue(b, column);
          const aNumber = Number(aValue);
          const bNumber = Number(bValue);
          const comparison = Number.isFinite(aNumber) && Number.isFinite(bNumber)
            ? aNumber - bNumber
            : aValue.localeCompare(bValue, undefined, { numeric: true, sensitivity: 'base' });
          return sortConfig.direction === 'asc' ? comparison : -comparison;
        });
      }
    }

    return nextRows;
  }, [columns, filters, rows, sortConfig]);

  const totalPages = Math.max(Math.ceil(filteredRows.length / pageSize), 1);
  const currentPage = Math.min(page, totalPages);
  const pagedRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [filters, rows]);

  useEffect(() => {
    setFilters(defaultFilters || {});
    setPage(1);
  }, [JSON.stringify(defaultFilters || {})]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const setSort = (key) => {
    setSortConfig(current => current.key === key
      ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: 'asc' });
  };

  const renderCell = (row, column) => {
    if (column.key === 'cvssScore') return <CvssScore score={row.cvssScore} severity={row.severity} />;
    if (column.render) return column.render(row);
    if (column.value) return column.value(row);
    return row[column.key];
  };

  if (!rows || rows.length === 0) {
    return <div style={{ color: colors.muted, padding: '1rem 0', fontFamily, fontSize: 13 }}>{emptyText || 'No records found.'}</div>;
  }

  const gridTemplateColumns = columns.map(column => column.width ? `${column.width}px` : 'minmax(120px, 1fr)').join(' ');
  const minWidth = columns.reduce((total, column) => total + (column.width || 160), 0);

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth, color: colors.text, fontFamily, fontSize: 13 }}>
        <div style={{ display: 'grid', gridTemplateColumns, background: colors.pale, borderBottom: `1px solid ${colors.border}` }}>
          {columns.map(column => (
            <div key={column.key} style={subTh}>
              <button type="button" onClick={() => setSort(column.key)} style={sortHeaderButton}>
                {column.label}
                <span style={sortIndicator}>{sortConfig.key === column.key ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns, background: colors.pale, borderBottom: `1px solid ${colors.border}` }}>
          {columns.map(column => (
            <div key={`${column.key}-filter`} style={filterTh}>
              <ColumnFilterInput
                value={filters[column.key] || ''}
                onChange={value => setFilters(current => ({ ...current, [column.key]: value }))}
                placeholder="Filter"
              />
            </div>
          ))}
        </div>
        <div>
          {filteredRows.length === 0 ? (
            <div style={{ ...subTd, color: colors.muted, textAlign: 'center' }}>No records match the current filters.</div>
          ) : pagedRows.map((row, index) => (
            <div key={row.id || `${row.cve || row.endpoint_name || row.name}-${index}`} style={{ display: 'grid', gridTemplateColumns, borderBottom: `1px solid ${colors.border}` }}>
              {columns.map(column => <div key={column.key} style={subTd}>{renderCell(row, column)}</div>)}
            </div>
          ))}
        </div>
        <Pager page={currentPage} total={filteredRows.length} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={value => { setPageSize(value); setPage(1); }} />
      </div>
    </div>
  );
}
function softwareDisplay(row) {
  const software = String(row?.software_name || row?.plugin_name || row?.name || '').trim();
  const cve = String(row?.cve || '').trim();
  if (!software || software.toUpperCase() === cve.toUpperCase()) return 'Unknown software';
  return software;
}

const subTh = { textAlign: 'left', padding: '0.56rem 0.75rem', height: 34, boxSizing: 'border-box', fontWeight: 600, whiteSpace: 'nowrap', color: colors.header, fontSize: 12, background: colors.pale };
const filterTh = { textAlign: 'left', padding: '0.34rem 0.55rem 0.52rem', height: 38, boxSizing: 'border-box', background: colors.pale };
const subTd = { padding: '0.56rem 0.75rem', verticalAlign: 'top', color: colors.text, fontSize: 13 };

function PageFrame({ children }) {
  return <div style={{ background: colors.page, minHeight: 'calc(100vh - 80px)', padding: '0 0 1.5rem', color: colors.text, fontFamily }}>{children}</div>;
}

function GridWrap({ children }) {
  return <div style={{ background: '#fff', overflowX: 'auto', borderTop: `1px solid ${colors.border}`, borderBottom: `1px solid ${colors.border}` }}>{children}</div>;
}

const sortHeaderButton = {
  border: 0,
  background: 'transparent',
  padding: 0,
  color: 'inherit',
  font: 'inherit',
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
  whiteSpace: 'nowrap'
};

const sortIndicator = {
  color: colors.blue,
  fontSize: 10,
  lineHeight: 1,
  minWidth: 10
};

const filterInputStyle = {
  width: '100%',
  minWidth: 74,
  height: 26,
  border: '1px solid #C9D2E1',
  borderRadius: 4,
  padding: '0 0.45rem',
  fontSize: 12,
  outline: 'none',
  background: '#fff',
  color: colors.text,
  fontFamily
};

function ColumnFilterInput({ value, onChange, placeholder = 'Filter' }) {
  return (
    <input
      value={value}
      onChange={event => onChange(event.target.value)}
      placeholder={placeholder}
      style={filterInputStyle}
      onClick={event => event.stopPropagation()}
    />
  );
}

function SortableHeader({ column, sortConfig, onSort }) {
  if (column.sortable === false) {
    return <th style={{ ...th, minWidth: column.width }}>{column.label}</th>;
  }
  return (
    <th style={{ ...th, minWidth: column.width }}>
      <button type="button" onClick={() => onSort(column.sortKey || column.key)} style={sortHeaderButton}>
        {column.label}
        <span style={sortIndicator}>{sortConfig.key === (column.sortKey || column.key) ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

function FilterHeader({ column, filters, onFilterChange }) {
  if (column.filterable === false) return <th style={{ ...filterTh, minWidth: column.width }} />;
  const filterKey = column.filterKey || column.key;
  return (
    <th style={{ ...filterTh, minWidth: column.width }}>
      <ColumnFilterInput
        value={filters[filterKey] || ''}
        onChange={value => onFilterChange(filterKey, value)}
        placeholder={column.filterPlaceholder || 'Filter'}
      />
    </th>
  );
}

const th = { textAlign: 'left', padding: '0.58rem 0.9rem', borderBottom: `1px solid ${colors.border}`, fontWeight: 600, color: colors.header, whiteSpace: 'nowrap', fontSize: 12, background: colors.pale };
const td = { padding: '0.6rem 0.9rem', borderBottom: `1px solid ${colors.border}`, color: colors.text, verticalAlign: 'middle', fontSize: 13 };

export function Action1Vulnerabilities() {
  const { integration } = useParams();
  const location = useLocation();
  const [integrationMeta, setIntegrationMeta] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('endpoints');
  const detailPanelRef = useRef(null);
  const [sortConfig, setSortConfig] = useState({ key: 'severity', direction: 'asc' });
  const [columnFilters, setColumnFilters] = useState({});

  const params = new URLSearchParams(location.search);
  const severityFilter = params.get('severity') || '';
  const statusFilter = params.get('status') || '';

  useEffect(() => {
    fetch(`/api/marketplace/${integration}`).then(r => r.json()).then(setIntegrationMeta).catch(() => setIntegrationMeta(null));
  }, [integration]);

  const fetchParams = useMemo(() => {
    const apiParams = new URLSearchParams({
      integration,
      page: String(page),
      pageSize: String(pageSize),
      sortKey: sortConfig.key,
      sortDirection: sortConfig.direction
    });
    if (searchQuery) apiParams.set('search', searchQuery);
    if (severityFilter) apiParams.set('severityFilter', severityFilter);
    if (statusFilter) apiParams.set('statusFilter', statusFilter);
    Object.entries(columnFilters).forEach(([key, value]) => {
      if (value) apiParams.set(key, value);
    });
    return apiParams.toString();
  }, [columnFilters, integration, page, pageSize, searchQuery, severityFilter, sortConfig, statusFilter]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/cves?${fetchParams}`)
      .then(r => r.json())
      .then(data => {
        setRows(data.rows || []);
        setTotal(data.total || 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [fetchParams]);

  useEffect(() => setPage(1), [columnFilters, integration, pageSize, searchQuery, severityFilter, sortConfig, statusFilter]);

  useEffect(() => {
    if (!selected) return;
    window.requestAnimationFrame(() => {
      detailPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [selected?.id]);

  const updateColumnFilter = (key, value) => setColumnFilters(current => ({ ...current, [key]: value }));
  const updateSort = (key) => setSortConfig(current => current.key === key
    ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: 'asc' });

  const vulnerabilityColumns = [
    { key: 'cve', label: 'CVE', width: 150 },
    { key: 'cvssScore', label: 'CVSS Score', width: 130, sortKey: 'cvss_score', filterKey: 'cvss_score', exportValue: row => formatCvssScore(row.cvssScore) },
    { key: 'status', label: 'Remediation Status', width: 170, filterKey: 'statusColumn' },
    { key: 'source', label: 'Source', width: 120 },
    { key: 'plugin_name', label: 'Vulnerable Software', width: 260 },
    { key: 'endpointCount', label: 'Endpoints', width: 110, sortKey: 'endpoint_count', filterKey: 'endpoint_count' }
  ];

  const exportVulnerabilities = async (format) => {
    const title = `${integrationName} Vulnerabilities`;
    const exportRows = await fetchAllListRows('/api/cves', new URLSearchParams(fetchParams), total);
    if (format === 'csv') {
      downloadRowsCsv(`${safeFileName(title)}-${exportDateStamp()}.csv`, vulnerabilityColumns, exportRows);
    } else {
      downloadRowsPdf(`${safeFileName(title)}-${exportDateStamp()}.pdf`, title, `${exportRows.length} entries`, vulnerabilityColumns, exportRows);
    }
  };

  const loadDetails = row => {
    setSelected(row);
    setActiveTab('endpoints');
    setDetailLoading(true);
    fetch(`/api/cves/${row.id}/details?integration=${encodeURIComponent(integration)}`)
      .then(r => r.json())
      .then(data => setDetails(data))
      .catch(() => setDetails(null))
      .finally(() => setDetailLoading(false));
  };

  const integrationName = integrationMeta?.name || titleCase(integration);

  return (
    <PageFrame>
      <div style={{ padding: '1rem 1.25rem', background: '#fff' }}>
        <p style={{ margin: 0, color: colors.text, fontSize: '1rem' }}>Real-time assessment of software and OS vulnerabilities</p>
        {severityFilter || statusFilter ? (
          <div style={{ marginBottom: 10 }}>
            <span style={{ color: colors.muted }}>Filter: {severityFilter ? `Severity: ${severityFilter}` : `Status: ${statusFilter}`} </span>
            <Link to={`/apps/${integration}/vulnerabilities`} style={{ color: colors.blue, fontWeight: 700 }}>clear</Link>
          </div>
        ) : null}
      </div>

      <div style={{ padding: '0 1.25rem', background: '#fff' }}>
        <ExportButtons
          disabled={loading || total === 0}
          onCsv={() => exportVulnerabilities('csv')}
        />
      </div>

      <GridWrap>
        <table style={{ width: '100%', minWidth: 1100, borderCollapse: 'collapse', background: '#fff' }}>
          <thead>
            <tr>
              {vulnerabilityColumns.map(column => (
                <SortableHeader key={column.key} column={column} sortConfig={sortConfig} onSort={updateSort} />
              ))}
            </tr>
            <tr>
              {vulnerabilityColumns.map(column => (
                <FilterHeader key={`${column.key}-filter`} column={column} filters={columnFilters} onFilterChange={updateColumnFilter} />
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: colors.muted }}>Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: colors.muted }}>No vulnerabilities match the current filters.</td></tr>
            ) : rows.map(row => {
              const active = selected?.id === row.id;
              return (
                <tr key={row.id} onClick={() => { if (!isTextSelectionActive()) loadDetails(row); }} style={{ background: active ? colors.activeBlue : '#fff', cursor: 'pointer', borderTop: active ? `1px solid ${colors.activeBorder}` : 0, borderBottom: active ? `1px solid ${colors.activeBorder}` : 0 }}>
                  <td style={td}><CveLink value={row.cve} onSelect={() => loadDetails(row)} /></td>
                  <td style={td}><CvssScore score={row.cvssScore} severity={row.severity} /></td>
                  <td style={td}><RemediationStatus value={row.status} /></td>
                  <td style={td}>{row.source || integrationName}</td>
                  <td style={td}>{row.plugin_name || 'Unknown'}</td>
                  <td style={td}>{row.endpointCount || 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pager page={page} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </GridWrap>

      {selected && (
        <DetailShell
          title={selected.cve}
          summary={`CVSS Score: ${formatCvssScore(selected.cvssScore)}  ${selected.plugin_name ? `Vulnerable software: ${selected.plugin_name}` : ''}`}
          tabs={[
            { id: 'endpoints', label: 'Endpoints' },
            { id: 'vulnerableSoftware', label: 'Vulnerable Software' },
            { id: 'details', label: 'Details' }
          ]}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          panelRef={detailPanelRef}
          onClose={() => { setSelected(null); setDetails(null); }}
          onRefresh={() => loadDetails(selected)}
        >
          {detailLoading ? <div style={{ color: colors.muted }}>Loading details...</div> : activeTab === 'endpoints' ? (
            <MiniTable
              columns={[
                {
                  key: 'endpoint_name',
                  label: 'Endpoint',
                  render: row => (
                    <Link
                      to={`/apps/${integration}/endpoints?${new URLSearchParams({
                        endpointId: String(row.endpoint_id || ''),
                        endpoint_name: row.endpoint_name || ''
                      }).toString()}`}
                      style={{ color: colors.blue, fontWeight: 600, textDecoration: 'none' }}
                    >
                      {row.endpoint_name || 'N/A'}
                    </Link>
                  )
                },
                { key: 'plugin_name', label: 'Vulnerable Software' },
                { key: 'source', label: 'Source' },
                { key: 'os', label: 'OS' },
                { key: 'status', label: 'Remediation Status', render: row => <RemediationStatus value={row.status} /> }
              ]}
              rows={details?.endpoints || []}
              emptyText="No affected endpoints found."
            />
          ) : activeTab === 'vulnerableSoftware' ? (
            <MiniTable
              columns={[
                { key: 'name', label: 'Vulnerable Software' },
                { key: 'endpoints', label: 'Endpoints' }
              ]}
              rows={details?.vulnerableSoftware || []}
              emptyText="No vulnerable software details found."
            />
          ) : (
            <KeyValueRows rows={[
              ['CVSS Score', formatCvssScore(details?.vulnerability?.cvssScore ?? selected.cvssScore)],
              ['NVD', details?.vulnerability?.nvdUrl ? <a href={details.vulnerability.nvdUrl} target="_blank" rel="noreferrer">{details.vulnerability.nvdUrl}</a> : 'N/A'],
              ['CISA KEV', details?.vulnerability?.cisaKev],
              ['Ransomware', details?.vulnerability?.ransomware],
              ['Vector', details?.vulnerability?.vector],
              ['Impact Score', details?.vulnerability?.impactScore],
              ['Exploitability Score', details?.vulnerability?.exploitabilityScore],
              ['Published Date', details?.vulnerability?.publishedDate],
              ['Description', details?.details?.description],
              ['Solution', details?.details?.solution]
            ]} />
          )}
        </DetailShell>
      )}
    </PageFrame>
  );
}

export function Action1Endpoints() {
  const { integration } = useParams();
  const location = useLocation();
  const [integrationMeta, setIntegrationMeta] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
  const [endpointVulnerabilityFilters, setEndpointVulnerabilityFilters] = useState({});
  const [sortConfig, setSortConfig] = useState({ key: 'endpoint_name', direction: 'asc' });
  const [columnFilters, setColumnFilters] = useState({});
  const endpointQueryParams = new URLSearchParams(location.search);
  const filterType = endpointQueryParams.get('filter') || '';
  const linkedEndpointId = endpointQueryParams.get('endpointId') || '';
  const linkedEndpointName = endpointQueryParams.get('endpoint_name') || '';

  useEffect(() => {
    fetch(`/api/marketplace/${integration}`).then(r => r.json()).then(setIntegrationMeta).catch(() => setIntegrationMeta(null));
  }, [integration]);

  const integrationName = integrationMeta?.name || titleCase(integration);

  const fetchParams = useMemo(() => {
    const params = new URLSearchParams({
      integration,
      page: String(page),
      pageSize: String(pageSize),
      sortKey: sortConfig.key,
      sortDirection: sortConfig.direction
    });
    if (searchQuery) params.set('search', searchQuery);
    if (filterType) params.set('filterType', filterType);
    Object.entries(columnFilters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return params.toString();
  }, [columnFilters, filterType, integration, page, pageSize, searchQuery, sortConfig]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/endpoints?${fetchParams}`)
      .then(r => r.json())
      .then(data => {
        setRows(data.rows || []);
        setTotal(data.total || 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [fetchParams]);

  useEffect(() => setPage(1), [columnFilters, filterType, integration, pageSize, searchQuery, sortConfig]);

  useEffect(() => {
    if (!linkedEndpointName) return;
    setColumnFilters(current => current.endpoint_name === linkedEndpointName
      ? current
      : { ...current, endpoint_name: linkedEndpointName });
  }, [integration, linkedEndpointName]);

  const updateColumnFilter = (key, value) => setColumnFilters(current => ({ ...current, [key]: value }));
  const updateSort = (key) => setSortConfig(current => current.key === key
    ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: 'asc' });

  const loadDetails = row => {
    setSelected(row);
    setActiveTab('general');
    setEndpointVulnerabilityFilters({});
    setDetailLoading(true);
    fetch(`/api/endpoints/${row.id}/details?integration=${encodeURIComponent(integration)}`)
      .then(r => r.json())
      .then(data => setDetails(data))
      .catch(() => setDetails(null))
      .finally(() => setDetailLoading(false));
  };

  useEffect(() => {
    if (!linkedEndpointId || loading || selected?.id === Number(linkedEndpointId)) return;
    const linkedRow = rows.find(row => String(row.id) === String(linkedEndpointId));
    if (linkedRow) loadDetails(linkedRow);
  }, [linkedEndpointId, loading, rows, selected?.id]);

  const getStatus = row => row.missing_from_tenable ? `Missing (${integrationName})` : row.missing_from_action1 ? 'Missing (Action1)' : 'Synced';
  const vulnerabilitySummary = row => `${row.critical_vulns || 0} critical, ${(row.high_vulns || 0) + (row.medium_vulns || 0) + (row.low_vulns || 0)} non-critical`;
  const endpointColumns = [
    { key: 'endpoint_name', label: 'Name', width: 180 },
    { key: 'status', label: 'Status', width: 130, exportValue: getStatus },
    { key: 'os', label: 'OS', width: 180 },
    { key: 'vulnerabilities', label: 'Vulnerabilities', width: 170, exportValue: vulnerabilitySummary }
  ];

  const exportEndpoints = async (format) => {
    const title = `${integrationName} Endpoints`;
    const exportRows = await fetchAllListRows('/api/endpoints', new URLSearchParams(fetchParams), total);
    if (format === 'csv') {
      downloadRowsCsv(`${safeFileName(title)}-${exportDateStamp()}.csv`, endpointColumns, exportRows);
    } else {
      downloadRowsPdf(`${safeFileName(title)}-${exportDateStamp()}.pdf`, title, `${exportRows.length} entries`, endpointColumns, exportRows);
    }
  };

  const renderEndpointTab = () => {
    if (detailLoading) return <div style={{ color: colors.muted }}>Loading details...</div>;
    const endpoint = details?.endpoint || selected || {};
    if (activeTab === 'general') {
      return (
        <KeyValueRows rows={[
          ['Name', endpoint.endpoint_name],
          ['User', endpoint.user],
          ['AD organizational unit', endpoint.adOrganizationalUnit],
          ['Comment', endpoint.comment],
          ['Status', endpoint.status || getStatus(endpoint)],
          ['Subscription', endpoint.action1_id ? 'Active' : 'N/A'],
          ['Reboot', endpoint.reboot],
          ['OS', endpoint.os],
          ['Platform', endpoint.platform],
          ['Architecture', endpoint.architecture],
          ['Agent version', endpoint.agentVersion],
          ['Last seen', endpoint.lastSeen],
          ['Last boot time', endpoint.lastBootTime],
          ['Agent install date', endpoint.agentInstallDate],
          ['Manufacturer', endpoint.manufacturer],
          ['CPU name', endpoint.cpu],
          ['GPU model', endpoint.gpu],
          ['RAM', endpoint.ram],
          ['Disk', endpoint.disk],
          ['NIC', endpoint.nic],
          ['Wi-Fi', endpoint.wifi],
          ['MAC', endpoint.mac],
          ['IP address', endpoint.ipv4],
          ['Serial number', endpoint.serialNumber],
          ['AD security groups', endpoint.adSecurityGroups],
          ['Endpoint groups', (endpoint.endpointGroups || []).join(', ')]
        ]} />
      );
    }
    if (activeTab === 'vulnerabilities') {
      return (
        <MiniTable
          columns={[
            { key: 'cve', label: 'CVE', render: row => <CveLink value={row.cve} /> },
            { key: 'software_name', label: 'Vulnerable Software', render: softwareDisplay },
            { key: 'source', label: 'Source' },
            { key: 'cvssScore', label: 'CVSS Score', value: row => formatCvssScore(row.cvssScore), render: row => <CvssScore score={row.cvssScore} severity={row.severity} /> },
            { key: 'severity', label: 'Severity' },
            { key: 'status', label: 'Status', render: row => <RemediationStatus value={row.status} /> }
          ]}
          rows={details?.vulnerabilities || []}
          defaultFilters={endpointVulnerabilityFilters}
          emptyText="No vulnerabilities found for this endpoint."
        />
      );
    }
    if (activeTab === 'installedSoftware') {
      return (
        <MiniTable
          columns={[
            {
              key: 'name',
              label: 'Name',
              render: row => (
                <button
                  type="button"
                  onClick={() => {
                    setEndpointVulnerabilityFilters({ software_name: row.name || '' });
                    setActiveTab('vulnerabilities');
                  }}
                  style={{ background: 'transparent', border: 0, padding: 0, color: colors.blue, font: 'inherit', fontWeight: 500, cursor: 'pointer', textAlign: 'left' }}
                >
                  {row.name || 'N/A'}
                </button>
              )
            },
            { key: 'vulnerabilities', label: 'Vulnerabilities' }
          ]}
          rows={details?.installedSoftware || []}
          emptyText="No software details found."
        />
      );
    }
    return null;
  };

  return (
    <PageFrame>
      <div style={{ padding: '0 1.25rem', background: '#fff' }}>
        <ExportButtons
          disabled={loading || total === 0}
          onCsv={() => exportEndpoints('csv')}
        />
      </div>

      <GridWrap>
        <table style={{ width: '100%', minWidth: 700, borderCollapse: 'collapse', background: '#fff' }}>
          <thead>
            <tr>
              {endpointColumns.map(column => (
                <SortableHeader key={column.key} column={column} sortConfig={sortConfig} onSort={updateSort} />
              ))}
            </tr>
            <tr>
              {endpointColumns.map(column => (
                <FilterHeader key={`${column.key}-filter`} column={column} filters={columnFilters} onFilterChange={updateColumnFilter} />
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: colors.muted }}>Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: colors.muted }}>No endpoints match the current filters.</td></tr>
            ) : rows.map(row => {
              const active = selected?.id === row.id;
              const vulnerabilityText = vulnerabilitySummary(row);
              return (
                <tr key={row.id} onClick={() => { if (!isTextSelectionActive()) loadDetails(row); }} style={{ background: active ? colors.activeBlue : '#fff', cursor: 'pointer', borderTop: active ? `1px solid ${colors.activeBorder}` : 0, borderBottom: active ? `1px solid ${colors.activeBorder}` : 0 }}>
                  <td style={{ ...td, color: colors.blue, fontWeight: 600 }}>{row.endpoint_name}</td>
                  <td style={td}>{getStatus(row)}</td>
                  <td style={td}>{row.os || 'N/A'}</td>
                  <td style={td}>{vulnerabilityText}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pager page={page} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </GridWrap>

      {selected && (
        <DetailShell
          title={selected.endpoint_name}
          summary=""
          tabs={[
            { id: 'general', label: 'General' },
            { id: 'vulnerabilities', label: 'Vulnerabilities' },
            { id: 'installedSoftware', label: 'Installed Software' }
          ]}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onClose={() => { setSelected(null); setDetails(null); }}
          onRefresh={() => loadDetails(selected)}
        >
          {renderEndpointTab()}
        </DetailShell>
      )}
    </PageFrame>
  );
}
