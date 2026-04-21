import { S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';

export const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});

export const S3_BUCKET = env.S3_BUCKET;
export const S3_PUBLIC_BASE_URL = env.S3_PUBLIC_BASE_URL.replace(/\/$/, '');
