import { Request, Response, type NextFunction } from 'express';
import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';

export const register = new Registry();

collectDefaultMetrics({ register });

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});

export const databaseQueryDuration = new Histogram({
  name: 'dukapay_database_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation', 'table'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2],
  registers: [register],
});

export const blockchainTransactionDuration = new Histogram({
  name: 'dukapay_blockchain_transaction_duration_seconds',
  help: 'Blockchain transaction duration in seconds',
  labelNames: ['network', 'operation'],
  buckets: [1, 5, 10, 30, 60, 120],
  registers: [register],
});

export function metricsMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    res.on('finish', () => {
      const duration = (Date.now() - start) / 1000;
      const route = req.route?.path || req.path;

      httpRequestsTotal.inc({
        method: req.method,
        route,
        status: res.statusCode,
      });

      httpRequestDuration.observe(
        {
          method: req.method,
          route,
          status: res.statusCode,
        },
        duration,
      );
    });

    next();
  };
}

export function metricsEndpoint() {
  return async (_req: Request, res: Response) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  };
}
