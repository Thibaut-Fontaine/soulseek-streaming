/**
 * VPS entry point for the log ingest service (feature 7).
 *
 * Run: node server/logs/index.js (after `npx tsc -p server/logs/tsconfig.json`)
 * Environment:
 *   PORT                     listen port on 127.0.0.1 (default 8100)
 *   SOULSTREAM_LOG_FILE      JSON snapshot (default /var/lib/soulstream-logs/events.json)
 *   SOULSTREAM_LOG_TOKEN     optional shared bearer token
 *   SOULSTREAM_LOG_DAYS      retention in days (default 7)
 *   SOULSTREAM_LOG_RECORDS   max stored events (default 50000)
 *   TRUST_PROXY              "1" when nginx forwards X-Forwarded-For
 *
 * TLS and the public hostname are handled by nginx, configured by the owner.
 */
import { FileLogStore } from './fileStore';
import { createLogServer } from './http';

const port = Number(process.env.PORT ?? 8100);
const file = process.env.SOULSTREAM_LOG_FILE ?? '/var/lib/soulstream-logs/events.json';
const days = Number(process.env.SOULSTREAM_LOG_DAYS ?? 7);
const maxRecords = Number(process.env.SOULSTREAM_LOG_RECORDS ?? 50_000);
const ingestToken = process.env.SOULSTREAM_LOG_TOKEN || null;

const store = new FileLogStore({
  path: file,
  retentionMs: (Number.isFinite(days) && days > 0 ? days : 7) * 24 * 60 * 60 * 1000,
  maxRecords: Number.isFinite(maxRecords) && maxRecords > 0 ? maxRecords : 50_000,
});

const { server } = createLogServer({
  store,
  ingestToken,
  trustProxy: process.env.TRUST_PROXY === '1',
});

server.listen(port, '127.0.0.1', () => {
  // Intentionally no request data in this line.
  console.log(`soulstream log ingest listening on 127.0.0.1:${port}`);
});

// Retention is also applied on each batch; this catches a quiet service.
const housekeeping = setInterval(() => store.prune(), 60 * 60 * 1000);
housekeeping.unref();

function shutdown(): void {
  clearInterval(housekeeping);
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
