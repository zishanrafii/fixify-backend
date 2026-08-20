function interpolate(template, variables = {}, { escapeHtml = false } = {}) {
  if (!template) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = variables[key];
    if (value === undefined || value === null) return '';
    const str = String(value);
    return escapeHtml ? escapeHtmlChars(str) : str;
  });
}

function escapeHtmlChars(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { interpolate };
