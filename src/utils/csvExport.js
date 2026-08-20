function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

// Writes rows directly to an Express response as a CSV download.
function sendCsv(res, filename, columns, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  res.write(columns.map(csvEscape).join(',') + '\n');
  for (const row of rows) {
    res.write(columns.map((col) => csvEscape(row[col])).join(',') + '\n');
  }
  res.end();
}

module.exports = { sendCsv };
