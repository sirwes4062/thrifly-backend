import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';

import { SwapsService } from './swaps.service.js';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard.js';
import { CreateSwapRequestDto } from './dto/create-swap-request.dto.js';

@Controller()
@UseGuards(SupabaseAuthGuard)
export class SwapsController {
  constructor(private readonly swapsService: SwapsService) {}

  @Post('groups/:groupId/turn-swaps')
  createRequest(
    @Param('groupId') groupId: string,
    @Body() dto: CreateSwapRequestDto,
    @Req() req: any,
  ) {
    return this.swapsService.createRequest(groupId, req.user.id, dto);
  }

  @Get('groups/:groupId/turn-swaps/received')
  getReceivedRequests(@Param('groupId') groupId: string, @Req() req: any) {
    return this.swapsService.getReceivedRequests(groupId, req.user.id);
  }

  @Get('groups/:groupId/turn-swaps/sent')
  getSentRequests(@Param('groupId') groupId: string, @Req() req: any) {
    return this.swapsService.getSentRequests(groupId, req.user.id);
  }

  @Patch('turn-swaps/:requestId/accept')
  acceptRequest(@Param('requestId') requestId: string, @Req() req: any) {
    return this.swapsService.acceptRequest(requestId, req.user.id);
  }

  @Patch('turn-swaps/:requestId/decline')
  declineRequest(@Param('requestId') requestId: string, @Req() req: any) {
    return this.swapsService.declineRequest(requestId, req.user.id);
  }
}
