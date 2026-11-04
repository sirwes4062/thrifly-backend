import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PaystackModule } from './integrations/paystack/paystack.module.js';
import { WalletsModule } from './wallets/wallets.module.js';
import { GroupsModule } from './groups/groups.module.js';

@Module({
  imports: [PrismaModule, PaystackModule, WalletsModule, GroupsModule, AuthModule],

  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
