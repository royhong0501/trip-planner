import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { presignUploadSchema } from '@trip-planner/shared-schema';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { S3_BUCKET, S3_PUBLIC_BASE_URL, s3 } from '../storage/s3.js';

export const uploadsRouter = Router();

const PRESIGN_EXPIRES_SECONDS = 60 * 5;
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/**
 * POST /api/uploads/cover  →  presigned PUT url + final public URL.
 * The frontend uploads the bytes directly to MinIO / S3, then saves `publicUrl`
 * into trips.cover_image (or similar).
 */
uploadsRouter.post(
  '/cover',
  requireAdmin,
  validate(presignUploadSchema, 'body'),
  asyncHandler(async (req, res) => {
    const { kind, contentType, size } = req.body as {
      kind: 'cover' | 'hero' | 'activity' | 'homepage';
      contentType: string;
      size: number;
    };
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      res.status(400).json({ error: `Unsupported content-type: ${contentType}` });
      return;
    }

    const ext = contentType.split('/')[1] ?? 'bin';
    const key = `${kind}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: contentType,
      ContentLength: size,
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: PRESIGN_EXPIRES_SECONDS });

    res.json({
      key,
      uploadUrl,
      publicUrl: `${S3_PUBLIC_BASE_URL}/${key}`,
      expiresIn: PRESIGN_EXPIRES_SECONDS,
    });
  }),
);
