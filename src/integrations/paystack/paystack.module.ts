import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { PaystackService } from './paystack.service.js';
import { PaystackWebhookController } from './paystack-webhook.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [PaystackWebhookController],
  providers: [PaystackService],
  exports: [PaystackService],
})
export class PaystackModule {}
