import { Module } from '@nestjs/common';
import { SwapsController } from './swaps.controller.js';
import { SwapsService } from './swaps.service.js';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard.js';

@Module({
  controllers: [SwapsController],
  providers: [SwapsService, SupabaseAuthGuard],
})
export class SwapsModule {}
