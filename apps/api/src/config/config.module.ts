import { Global, Module } from '@nestjs/common';
import { parseEnv, type Env } from './env.schema.js';

/** Injection token for the parsed env object. */
export const APP_CONFIG = Symbol('APP_CONFIG');

export type AppConfig = Env;

/**
 * Provides the parsed env via `@Inject(APP_CONFIG)`. Marked global so feature
 * modules don't have to re-import it.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => parseEnv(),
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
