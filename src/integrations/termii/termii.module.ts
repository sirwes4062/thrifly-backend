import { Module } from '@nestjs/common';
import { TermiiService } from './termii.service.js';

@Module({
  providers: [TermiiService],
  exports: [TermiiService],
})
export class TermiiModule {}
