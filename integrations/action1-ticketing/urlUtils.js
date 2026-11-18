function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function trimLeadingSlash(value) {
  return String(value || '').replace(/^\/+/, '');
}

function joinUrl(baseUrl, path) {
  const base = trimTrailingSlash(baseUrl);
  const nextPath = trimLeadingSlash(path);
  return `${base}/${nextPath}`;
}

function appendQuery(url, query) {
  const next = new URL(String(url));
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    next.searchParams.set(String(key), String(value));
  }
  return next.toString();
}

function toAbsoluteUrl(baseUrl, maybeAbsoluteOrRelative) {
  const value = String(maybeAbsoluteOrRelative || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  const base = new URL(String(baseUrl || ''));
  return new URL(value, `${base.protocol}//${base.host}`).toString();
}

function ensureUrl(value, name) {
  try {
    const next = String(value || '').trim();
    if (!next) throw new Error('missing url');
    return new URL(next).toString();
  } catch {
    throw new Error(`${name} must be a valid absolute URL`);
  }
}

module.exports = {
  appendQuery,
  ensureUrl,
  joinUrl,
  toAbsoluteUrl,
  trimLeadingSlash,
  trimTrailingSlash
};
