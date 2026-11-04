import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { TermiiModule } from '../integrations/termii/termii.module.js';
import { WalletsModule } from '../wallets/wallets.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [TermiiModule, WalletsModule, PrismaModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
