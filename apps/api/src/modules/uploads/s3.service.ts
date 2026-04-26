import { Inject, Injectable } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { APP_CONFIG, type AppConfig } from '../../config/config.module.js';

@Injectable()
export class S3Service {
  readonly client: S3Client;
  readonly bucket: string;
  readonly publicBaseUrl: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
    });
    this.bucket = config.S3_BUCKET;
    this.publicBaseUrl = config.S3_PUBLIC_BASE_URL.replace(/\/$/, '');
  }
}
