import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { presignUploadSchema } from '@trip-planner/shared-schema';
import { AdminGuard } from '../../common/guards/admin.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { S3Service } from './s3.service.js';

const PRESIGN_EXPIRES_SECONDS = 60 * 5;
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

@Controller('api/uploads')
@UseGuards(AdminGuard)
export class UploadsController {
  constructor(private readonly s3: S3Service) {}

  /**
   * POST /api/uploads/cover  →  presigned PUT url + final public URL.
   * The frontend uploads bytes directly to MinIO / S3, then saves `publicUrl`
   * into trips.cover_image (or similar).
   */
  @Post('cover')
  async coverPresign(
    @Body(new ZodValidationPipe(presignUploadSchema))
    body: {
      kind: 'cover' | 'hero' | 'activity' | 'homepage';
      contentType: string;
      size: number;
    },
  ) {
    if (!ALLOWED_CONTENT_TYPES.has(body.contentType)) {
      throw new BadRequestException({
        error: `Unsupported content-type: ${body.contentType}`,
      });
    }

    const ext = body.contentType.split('/')[1] ?? 'bin';
    const key = `${body.kind}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
    const command = new PutObjectCommand({
      Bucket: this.s3.bucket,
      Key: key,
      ContentType: body.contentType,
      ContentLength: body.size,
    });
    const uploadUrl = await getSignedUrl(this.s3.client, command, {
      expiresIn: PRESIGN_EXPIRES_SECONDS,
    });

    return {
      key,
      uploadUrl,
      publicUrl: `${this.s3.publicBaseUrl}/${key}`,
      expiresIn: PRESIGN_EXPIRES_SECONDS,
    };
  }
}
