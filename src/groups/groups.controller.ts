import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import { GroupsService, CreateGroupDto } from './groups.service.js';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard.js';

import { contribution_frequency } from '@prisma/client';

@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Post('create')
  @UseGuards(SupabaseAuthGuard)
  async createCircle(
    @Req() req: any,
    @Body()
    body: {
      groupName: string;
      contributionAmount: number;
      contributionFrequency: contribution_frequency;
      cycleLength: number;
      payoutDay?: number;
      adminPhone: string;
    },
  ) {
    // Get the authenticated user ID.
    // Do not trust an ID supplied through a request header.
    const adminId = req.user?.id;

    if (!adminId) {
      throw new UnauthorizedException(
        'You must be authenticated to create a group',
      );
    }

    const payload: CreateGroupDto = {
      adminId,
      groupName: body.groupName,
      contributionAmount: Number(body.contributionAmount),
      contributionFrequency: body.contributionFrequency,
      cycleLength: Number(body.cycleLength),

      payoutDay:
        body.payoutDay !== undefined ? Number(body.payoutDay) : undefined,

      adminPhone: body.adminPhone,
    };

    return this.groupsService.createGroup(payload);
  }

  @Get()
  @UseGuards(SupabaseAuthGuard)
  async getMyGroups(@Req() req: any) {
    const userId = req.user?.id;

    if (!userId) {
      throw new UnauthorizedException(
        'You must be authenticated to view your groups',
      );
    }

    return this.groupsService.getMyGroups(userId);
  }

  @Get(':id')
  async getGroup(@Param('id') id: string) {
    return this.groupsService.getGroupDetails(id);
  }

  @Post(':groupId/contribute')
  @UseGuards(SupabaseAuthGuard)
  async contributeToGroup(@Param('groupId') groupId: string, @Req() req: any) {
    return this.groupsService.contributeFromWallet({
      groupId,
      userId: req.user.id,
    });
  }
}
