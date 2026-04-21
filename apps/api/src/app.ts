import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env, isDev, isTest } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.js';
import { tripsRouter } from './routes/trips.js';
import { todosRouter } from './routes/todos.js';
import { participantsRouter } from './routes/participants.js';
import { expensesRouter } from './routes/expenses.js';
import { weatherRouter } from './routes/weather.js';
import { adminUsersRouter } from './routes/adminUsers.js';
import { homepageRouter } from './routes/homepage.js';
import { uploadsRouter } from './routes/uploads.js';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean),
      credentials: true,
    }),
  );
  app.use(cookieParser());
  // daily_itineraries JSONB can be large (embedded base64 images) → 10mb like the plan.
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(compression());

  if (!isTest) {
    app.use(morgan(isDev ? 'dev' : 'combined'));
  }

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', env: env.NODE_ENV, time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/admin/users', adminUsersRouter);
  app.use('/api/trips', tripsRouter);
  app.use('/api', todosRouter);
  app.use('/api', participantsRouter);
  app.use('/api', expensesRouter);
  app.use('/api/weather', weatherRouter);
  app.use('/api/homepage-settings', homepageRouter);
  app.use('/api/uploads', uploadsRouter);

  // 404 for unmatched /api routes
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: 'Route not found' });
      return;
    }
    next();
  });

  app.use(errorHandler);
  return app;
}
