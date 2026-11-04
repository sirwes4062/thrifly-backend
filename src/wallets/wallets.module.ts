import { Module } from '@nestjs/common';
import { WalletsService } from './wallets.service.js';
import { WalletsController } from './wallets.controller.js';
import { PaystackModule } from '../integrations/paystack/paystack.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PaystackModule, PrismaModule],
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
