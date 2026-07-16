const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERN = /^(?:authorization|auth[_-]?header|api[_-]?key|proxy[_-]?token|access[_-]?token|server[_-]?password|password|secret|token|YIBIAO_OPENCODE_PROXY_TOKEN|OPENCODE_SERVER_PASSWORD)$/i;
const SENSITIVE_LABEL = '(?:authorization|auth[_-]?header|api[_-]?key|proxy[_-]?token|access[_-]?token|server[_\\s-]?password|password|secret|token|YIBIAO_OPENCODE_PROXY_TOKEN|OPENCODE_SERVER_PASSWORD)';
const AUTHORIZATION_PATTERN = /(authorization\s*[:=]\s*)(bearer|basic)\s+([^\s,;"'\]}]+)/gi;
const AUTH_SCHEME_PATTERN = /\b(bearer|basic)\s+([A-Za-z0-9._~+/=-]+)/gi;
const SENSITIVE_ASSIGNMENT_PATTERN = new RegExp(
  `((?:"|')?${SENSITIVE_LABEL}(?:"|')?\\s*[:=]\\s*)(?:"[^"\\r\\n]*"|'[^'\\r\\n]*'|[^\\s,;\\]}]+)`,
  'gi',
);

function normalizeSecrets(secrets) {
  return [...new Set((Array.isArray(secrets) ? secrets : [])
    .filter((value) => typeof value === 'string' && value.length >= 4))]
    .sort((left, right) => right.length - left.length);
}

function redactOpenCodeSensitiveText(value, secrets = []) {
  let text = String(value ?? '');
  normalizeSecrets(secrets).forEach((secret) => {
    text = text.split(secret).join(REDACTED);
  });
  text = text.replace(AUTHORIZATION_PATTERN, (_match, prefix, scheme) => `${prefix}${scheme} ${REDACTED}`);
  text = text.replace(AUTH_SCHEME_PATTERN, (_match, scheme) => `${scheme} ${REDACTED}`);
  text = text.replace(SENSITIVE_ASSIGNMENT_PATTERN, (_match, prefix) => `${prefix}${REDACTED}`);
  return text;
}

function redactOpenCodeSensitiveValue(value, secrets = [], seen = new WeakSet()) {
  if (typeof value === 'string') return redactOpenCodeSensitiveText(value, secrets);
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return redactOpenCodeSensitiveText(value.toString('utf-8'), secrets);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactOpenCodeSensitiveValue(item, secrets, seen));
  }

  const result = {};
  Object.entries(value).forEach(([key, item]) => {
    result[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? REDACTED
      : redactOpenCodeSensitiveValue(item, secrets, seen);
  });
  return result;
}

module.exports = {
  REDACTED,
  redactOpenCodeSensitiveText,
  redactOpenCodeSensitiveValue,
};
