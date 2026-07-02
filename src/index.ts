import pino from 'pino';

import { run } from './orchestrator.js';

const isDev = process.env.NODE_ENV !== 'production';
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(isDev ? { transport: { target: 'pino-pretty' } } : {}),
});

run(logger).catch((err) => {
  logger.fatal({ err }, 'Fatal orchestrator failure');
  process.exit(1);
});
