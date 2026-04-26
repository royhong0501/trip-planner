import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller.js';
import { S3Service } from './s3.service.js';

@Module({
  controllers: [UploadsController],
  providers: [S3Service],
})
export class UploadsModule {}
