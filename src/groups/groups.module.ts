import { Module } from '@nestjs/common';
import { GroupsService } from './groups.service.js';
import { GroupsController } from './groups.controller.js';
import { PaystackModule } from '../integrations/paystack/paystack.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard.js';

@Module({
  imports: [PaystackModule, PrismaModule],
  controllers: [GroupsController],
  providers: [GroupsService, SupabaseAuthGuard],
  exports: [GroupsService],
})
export class GroupsModule {}
