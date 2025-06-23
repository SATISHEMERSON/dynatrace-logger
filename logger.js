import winston from 'winston';
import axios from 'axios';
import https from 'https';

class DynatraceTransport extends winston.Transport {
  constructor(opts) {
    super(opts);
    this.buffer = [];
    this.flushInterval = opts && opts.flushInterval ? opts.flushInterval : 5000; // ms
    this.maxBatchSize = opts && opts.maxBatchSize ? opts.maxBatchSize : 50;
    this.timer = setInterval(() => this.flush(), this.flushInterval);
  }

  log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    // Add log to buffer
    this.buffer.push({
      timestamp: Date.now(),
      status: info.level.toUpperCase(),
      loglevel: info.level.toUpperCase(),
      environment: process.env.DT_ENVIRONMENT || 'unknown',
      appname: process.env.APP_NAME || 'Express App',
      service: process.env.DT_SERVICE_NAME || 'express-app',
      content: info.message,
      severity: info.level.toUpperCase(),
      segment: process.env.SEGMENT || 'default',
      hostname: process.env.HOSTNAME || 'unknown',
      test: process.env.TEST || 'nodetest',
      attributes: {
        service: 'nodetest',
        ...info.metadata,
      },
    });

    // If buffer is large, flush immediately
    if (this.buffer.length >= this.maxBatchSize) {
      this.flush();
    }

    callback();
  }

  async flush() {
    if (this.buffer.length === 0) return;

    const DT_API_TOKEN = process.env.DT_API_TOKEN;
    const DT_ENDPOINT = process.env.DT_ENDPOINT;
    if (!DT_API_TOKEN || !DT_ENDPOINT) return;

    const url = `https://${DT_ENDPOINT}.live.dynatrace.com/api/v2/logs/ingest`;
    const batch = this.buffer.splice(0, this.maxBatchSize);

    try {
      await axios.post(url, batch, {
        headers: {
          Authorization: `Api-Token ${DT_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      });
      console.log(`Batch of ${batch.length} logs exported to Dynatrace successfully`);
    } catch (err) {
      console.error('Failed to export log batch to Dynatrace:', err.message);
      // Optionally, re-add failed logs to buffer
      this.buffer.unshift(...batch);
    }
  }

  close() {
    clearInterval(this.timer);
    this.flush();
  }
}

const removeTraceFields = winston.format((info) => {
  // Remove OpenTelemetry trace fields if present
  delete info.span_id;
  delete info.trace_flags;
  delete info.trace_id;
  return info;
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    // winston.format.timestamp(),
    removeTraceFields(),
    winston.format.simple()
  ),
  transports: [
    new winston.transports.Console(),
    new DynatraceTransport(),
  ],
});

const httpLogger = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const httpVersion = `HTTP/${req.httpVersion}`;
    const duration = Date.now() - start;
    const logMsg = `"${req.method} ${req.originalUrl} ${httpVersion}" ${res.statusCode} ${res.statusMessage || ''} ${duration}ms`;
    // log level based on status code
    // 2xx: info, 3xx: warn, 4xx: warn, 5xx: error
    const logLevel =
      res.statusCode >= 500 && res.statusCode <= 599
        ? 'error'
        : res.statusCode >= 400 && res.statusCode <= 499
        ? 'warn'
        : 'info';
    logger.log({
      level: logLevel,
      message: logMsg,
    });
  });
  next();
};

export { logger, httpLogger };