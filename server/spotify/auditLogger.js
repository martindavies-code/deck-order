import fs from 'node:fs';
import path from 'node:path';

/**
 * Redacted Write Audit Logger
 * Strictly logs all write operations, responses, and reconciliations to a local file.
 * Automatically redacts all tokens, secrets, auth codes, and API keys.
 */
class AuditLogger {
  constructor(logFilePath = './logs/write_audit.log') {
    this.logFilePath = path.resolve(logFilePath);
    this.ensureLogDir();
  }

  ensureLogDir() {
    try {
      const dir = path.dirname(this.logFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (err) {
      console.warn('[AuditLogger] Could not create logs directory:', err.message);
    }
  }

  /**
   * Deeply sanitizes objects or strings, scrubbing sensitive secrets
   */
  redact(obj) {
    if (!obj) return obj;

    if (typeof obj === 'string') {
      return obj
        .replace(/Bearer\s+[A-Za-z0-9\-_.]+/gi, 'Bearer [REDACTED_TOKEN]')
        .replace(/(refresh_token|client_secret|api_key|access_token|code)=([^&\s]+)/gi, '$1=[REDACTED]')
        .replace(/"(access_token|refresh_token|client_secret|api_key|code)":\s*"[^"]+"/gi, '"$1":"[REDACTED]"');
    }

    if (typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
      return obj.map(item => this.redact(item));
    }

    const sanitized = {};
    for (const [key, val] of Object.entries(obj)) {
      const lower = key.toLowerCase();
      if (
        lower.includes('token') ||
        lower.includes('secret') ||
        lower.includes('password') ||
        lower.includes('auth') ||
        lower.includes('key')
      ) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof val === 'object' && val !== null) {
        sanitized[key] = this.redact(val);
      } else if (typeof val === 'string') {
        sanitized[key] = this.redact(val);
      } else {
        sanitized[key] = val;
      }
    }
    return sanitized;
  }

  log(action, payload) {
    const timestamp = new Date().toISOString();
    const cleanPayload = this.redact(payload);
    const details = (cleanPayload && typeof cleanPayload === 'object' && !Array.isArray(cleanPayload))
      ? cleanPayload
      : { payload: cleanPayload };
    const entry = JSON.stringify({
      timestamp,
      action,
      ...details
    }) + '\n';

    try {
      this.ensureLogDir();
      fs.appendFileSync(this.logFilePath, entry, 'utf8');
    } catch (err) {
      console.warn('[AuditLogger] Failed to write audit log:', err.message);
    }
  }
}

export const auditLogger = new AuditLogger();
