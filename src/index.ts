import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import authRouter from './routes/auth.js';
import devicesRouter from './routes/devices.js';
import sessionsRouter from './routes/sessions.js';

const app = express();

app.use(helmet());
app.use(cors({
  origin: config.corsOrigins,
  credentials: true,
}));
// 6mb ceiling: /auth/avatar receives base64-encoded images (~4mb file → ~5.3mb JSON)
app.use(express.json({ limit: '6mb' }));

app.use('/auth', authRouter);
app.use('/devices', devicesRouter);
app.use('/sessions', sessionsRouter);

app.get('/', (_req, res) => {
  res.status(200).json({
    service: 'thay-auth',
    version: '1.0.0',
    status: 'running',
  });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  logger.info(`thay-auth running on port ${config.port}`);
  logger.info(`PocketBase URL: ${config.pbUrl}`);
});

export default app;
