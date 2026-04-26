import {
  ArgumentMetadata,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { ZodError, type ZodTypeAny, type z } from 'zod';

/**
 * Re-implements the legacy `validate(schema, source)` middleware: parse with
 * the supplied schema, throw ZodError on failure (handled by HttpExceptionFilter).
 *
 * Usage in controllers:
 *   @Post() create(@Body(new ZodValidationPipe(createTripSchema)) dto: CreateTripDto) {}
 */
@Injectable()
export class ZodValidationPipe<S extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: S) {}

  transform(value: unknown, _metadata: ArgumentMetadata): z.infer<S> {
    try {
      return this.schema.parse(value) as z.infer<S>;
    } catch (err) {
      if (err instanceof ZodError) throw err;
      throw err;
    }
  }
}
