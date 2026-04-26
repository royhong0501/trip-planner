import 'reflect-metadata';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { APP_CONFIG, type AppConfig } from './config/config.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  const config = app.get<AppConfig>(APP_CONFIG);
  const isProd = config.NODE_ENV === 'production';
  const isTest = config.NODE_ENV === 'test';
  const isDev = config.NODE_ENV === 'development';

  // Match the legacy createApp() ordering exactly so cookies/CORS/body limits stay parity.
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: config.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean),
      credentials: true,
    }),
  );
  app.use(cookieParser());
  // daily_itineraries JSONB can carry base64 images, so the legacy 10mb cap is intentional.
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(compression());
  if (!isTest) {
    app.use(morgan(isDev ? 'dev' : 'combined'));
  }

  app.useGlobalFilters(new HttpExceptionFilter({ isProd }));
  app.enableShutdownHooks();

  await app.listen(config.PORT);
  Logger.log(
    `[api] listening on http://localhost:${config.PORT} (${config.NODE_ENV})`,
    'Bootstrap',
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[api] failed to boot', err);
  process.exit(1);
});
