import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSwapRequestDto } from './dto/create-swap-request.dto.js';
import { turn_swap_status } from '@prisma/client';

@Injectable()
export class SwapsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Serializes swap operations within the same group.
   * This helps prevent simultaneous requests from changing
   * the same payout schedule at the same time.
   */
  //   private async lockGroup(tx: any, groupId: string): Promise<void> {
  //     await tx.$queryRaw`
  //       SELECT pg_advisory_xact_lock(
  //         hashtextextended(${groupId}, 0)
  //       )
  //     `;
  //   }

  /**
   * Serializes swap operations within the same group.
   */
  private async lockGroup(tx: any, groupId: string): Promise<void> {
    await tx.$queryRaw`
      SELECT 1 AS locked
      FROM (
        SELECT pg_advisory_xact_lock(
          hashtextextended(${groupId}, 0)
        )
      ) AS lock_result
    `;
  }

  /**
   * Creates a new swap request.
   */
  async createRequest(
    groupId: string,
    requesterId: string,
    dto: CreateSwapRequestDto,
  ) {
    const { recipientId, requesterTurn, recipientTurn } = dto;

    if (
      !groupId ||
      !recipientId ||
      !requesterId ||
      !Number.isInteger(requesterTurn) ||
      !Number.isInteger(recipientTurn) ||
      requesterTurn < 1 ||
      recipientTurn < 1
    ) {
      throw new BadRequestException('Invalid swap request details');
    }

    if (requesterId === recipientId) {
      throw new BadRequestException('You cannot request a swap with yourself');
    }

    if (requesterTurn === recipientTurn) {
      throw new BadRequestException('You cannot swap the same payout turn');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockGroup(tx, groupId);

      const group = await tx.groups.findUnique({
        where: { id: groupId },
        select: { id: true },
      });

      if (!group) {
        throw new NotFoundException('Group not found');
      }

      // Confirm that both users belong to this group.
      const members = await tx.group_members.findMany({
        where: {
          group_id: groupId,
          user_id: {
            in: [requesterId, recipientId],
          },
        },
        select: { user_id: true },
      });

      const memberIds = new Set(members.map((m) => m.user_id));

      if (!memberIds.has(requesterId) || !memberIds.has(recipientId)) {
        throw new ForbiddenException(
          'Both users must be members of this group',
        );
      }

      // Find the requester's assigned turn.
      const requesterSchedule = await tx.payout_schedule.findFirst({
        where: {
          group_id: groupId,
          payout_month: requesterTurn,
        },
      });

      // Find the recipient's assigned turn.
      const recipientSchedule = await tx.payout_schedule.findFirst({
        where: {
          group_id: groupId,
          payout_month: recipientTurn,
        },
      });

      if (!requesterSchedule || !recipientSchedule) {
        throw new NotFoundException('One or both payout turns do not exist');
      }

      if (
        requesterSchedule.user_id !== requesterId ||
        recipientSchedule.user_id !== recipientId
      ) {
        throw new BadRequestException(
          'The selected payout turns are not assigned to the expected members',
        );
      }

      // Only upcoming turns can be swapped.
      if (
        requesterSchedule.status !== 'upcoming' ||
        recipientSchedule.status !== 'upcoming'
      ) {
        throw new BadRequestException(
          'Only upcoming payout turns can be swapped',
        );
      }

      // Check whether either turn already has a payout record.
      const payoutHistory = await tx.payout_history.findFirst({
        where: {
          group_id: groupId,
          cycle_month: {
            in: [requesterTurn, recipientTurn],
          },
        },
      });

      if (payoutHistory) {
        throw new BadRequestException(
          'A payout has already been recorded for one of these turns',
        );
      }

      // Prevent multiple pending requests from reserving the same turn.
      const existingRequest = await tx.turn_swap_requests.findFirst({
        where: {
          group_id: groupId,
          status: turn_swap_status.PENDING,
          OR: [
            {
              requester_turn: {
                in: [requesterTurn, recipientTurn],
              },
            },
            {
              recipient_turn: {
                in: [requesterTurn, recipientTurn],
              },
            },
          ],
        },
      });

      if (existingRequest) {
        throw new ConflictException(
          'One of these payout turns already has a pending swap request',
        );
      }

      return tx.turn_swap_requests.create({
        data: {
          group_id: groupId,
          requester_id: requesterId,
          recipient_id: recipientId,
          requester_turn: requesterTurn,
          recipient_turn: recipientTurn,
          status: turn_swap_status.PENDING,
        },
      });
    });
  }

  /**
   * Gets requests sent by the authenticated member.
   */
  async getSentRequests(groupId: string, userId: string) {
    const membership = await this.prisma.group_members.findUnique({
      where: {
        group_id_user_id: {
          group_id: groupId,
          user_id: userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this group');
    }

    return this.prisma.turn_swap_requests.findMany({
      where: {
        group_id: groupId,
        requester_id: userId,
      },
      orderBy: {
        created_at: 'desc',
      },
    });
  }

  /**
   * Gets requests received by the authenticated member.
   */
  async getReceivedRequests(groupId: string, userId: string) {
    const membership = await this.prisma.group_members.findUnique({
      where: {
        group_id_user_id: {
          group_id: groupId,
          user_id: userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this group');
    }

    return this.prisma.turn_swap_requests.findMany({
      where: {
        group_id: groupId,
        recipient_id: userId,
      },
      orderBy: {
        created_at: 'desc',
      },
    });
  }

  /**
   * Accepts a swap request and exchanges the two assignments.
   */
  async acceptRequest(requestId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.turn_swap_requests.findUnique({
        where: { id: requestId },
      });

      if (!request) {
        throw new NotFoundException('Swap request not found');
      }

      if (request.recipient_id !== userId) {
        throw new ForbiddenException(
          'Only the recipient can accept this request',
        );
      }

      if (request.status !== turn_swap_status.PENDING) {
        throw new BadRequestException('This swap request is no longer pending');
      }

      await this.lockGroup(tx, request.group_id);

      // Re-read after acquiring the group lock.
      const currentRequest = await tx.turn_swap_requests.findUnique({
        where: { id: requestId },
      });

      if (
        !currentRequest ||
        currentRequest.status !== turn_swap_status.PENDING
      ) {
        throw new ConflictException(
          'This swap request has already been handled',
        );
      }

      // Lock both payout schedule rows.
      await tx.$queryRaw`
        SELECT id
        FROM public.payout_schedule
        WHERE group_id = ${request.group_id}::uuid
          AND payout_month IN (
            ${request.requester_turn},
            ${request.recipient_turn}
          )
        ORDER BY payout_month
        FOR UPDATE
      `;

      const requesterSchedule = await tx.payout_schedule.findFirst({
        where: {
          group_id: request.group_id,
          payout_month: request.requester_turn,
        },
      });

      const recipientSchedule = await tx.payout_schedule.findFirst({
        where: {
          group_id: request.group_id,
          payout_month: request.recipient_turn,
        },
      });

      if (!requesterSchedule || !recipientSchedule) {
        throw new NotFoundException('One or both payout turns no longer exist');
      }

      // Ensure the original assignments have not changed.
      if (
        requesterSchedule.user_id !== request.requester_id ||
        recipientSchedule.user_id !== request.recipient_id
      ) {
        throw new ConflictException(
          'The payout schedule has changed since this request was created',
        );
      }

      if (
        requesterSchedule.status !== 'upcoming' ||
        recipientSchedule.status !== 'upcoming'
      ) {
        throw new ConflictException(
          'One or both payout turns are no longer available for swapping',
        );
      }

      // Confirm neither turn has already been paid.
      const payoutHistory = await tx.payout_history.findFirst({
        where: {
          group_id: request.group_id,
          cycle_month: {
            in: [request.requester_turn, request.recipient_turn],
          },
        },
      });

      if (payoutHistory) {
        throw new ConflictException(
          'A payout has already been recorded for one of these turns',
        );
      }

      // Confirm both users are still group members.
      const members = await tx.group_members.findMany({
        where: {
          group_id: request.group_id,
          user_id: {
            in: [request.requester_id, request.recipient_id],
          },
        },
        select: { user_id: true },
      });

      if (members.length !== 2) {
        throw new ConflictException(
          'Both members must still belong to the group',
        );
      }

      // Exchange only the user assignments.
      const updateRequester = await tx.payout_schedule.updateMany({
        where: {
          id: requesterSchedule.id,
          user_id: request.requester_id,
          status: 'upcoming',
        },
        data: {
          user_id: request.recipient_id,
        },
      });

      const updateRecipient = await tx.payout_schedule.updateMany({
        where: {
          id: recipientSchedule.id,
          user_id: request.recipient_id,
          status: 'upcoming',
        },
        data: {
          user_id: request.requester_id,
        },
      });

      if (updateRequester.count !== 1 || updateRecipient.count !== 1) {
        throw new ConflictException(
          'The payout assignments could not be safely exchanged',
        );
      }

      // Mark the request as accepted.
      await tx.turn_swap_requests.update({
        where: { id: requestId },
        data: {
          status: turn_swap_status.ACCEPTED,
          responded_at: new Date(),
        },
      });

      return {
        message: 'Swap request accepted successfully',
        requesterTurn: request.requester_turn,
        recipientTurn: request.recipient_turn,
      };
    });
  }

  /**
   * Declines a pending swap request.
   */
  async declineRequest(requestId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.turn_swap_requests.findUnique({
        where: { id: requestId },
      });

      if (!request) {
        throw new NotFoundException('Swap request not found');
      }

      if (request.recipient_id !== userId) {
        throw new ForbiddenException(
          'Only the recipient can decline this request',
        );
      }

      await this.lockGroup(tx, request.group_id);

      const result = await tx.turn_swap_requests.updateMany({
        where: {
          id: requestId,
          recipient_id: userId,
          status: turn_swap_status.PENDING,
        },
        data: {
          status: turn_swap_status.DECLINED,
          responded_at: new Date(),
        },
      });

      if (result.count !== 1) {
        throw new ConflictException(
          'This swap request has already been handled',
        );
      }

      return {
        message: 'Swap request declined successfully',
      };
    });
  }
}
