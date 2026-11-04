import {
  Injectable,
  Logger,
  InternalServerErrorException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';

import { contribution_frequency } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';

import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

export interface CreateGroupDto {
  adminId: string;
  groupName: string;
  contributionAmount: number;
  contributionFrequency: contribution_frequency;
  cycleLength: number;
  payoutDay?: number;
  adminPhone: string;
}

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a group and keeps its funding reference
   * in the application instead of creating a bank account.
   */
  async createGroup(dto: CreateGroupDto) {
    // Validate contribution amount
    if (dto.contributionAmount <= 0) {
      throw new BadRequestException(
        'Contribution amount must be greater than zero',
      );
    }

    // Validate cycle length
    if (dto.cycleLength <= 0 || !Number.isInteger(dto.cycleLength)) {
      throw new BadRequestException(
        'Cycle length must be a positive whole number',
      );
    }

    // Validate group name
    if (!dto.groupName?.trim()) {
      throw new BadRequestException('Group name is required');
    }

    // Validate contribution frequency
    if (
      !Object.values(contribution_frequency).includes(dto.contributionFrequency)
    ) {
      throw new BadRequestException(
        'Invalid contribution frequency. Use DAILY, WEEKLY or MONTHLY.',
      );
    }

    // Only monthly groups need a monthly payout day.
    if (
      dto.contributionFrequency === contribution_frequency.MONTHLY &&
      (!dto.payoutDay ||
        !Number.isInteger(dto.payoutDay) ||
        dto.payoutDay < 1 ||
        dto.payoutDay > 31)
    ) {
      throw new BadRequestException(
        'Monthly groups require a valid payout day between 1 and 31',
      );
    }

    const reference = `G_${Date.now().toString().slice(-10)}`;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const group = await tx.groups.create({
          data: {
            group_name: dto.groupName.trim(),
            admin_id: dto.adminId,

            // Existing database field retained for compatibility.
            // This represents the contribution amount per period.
            contribution_amount: dto.contributionAmount,

            // New contribution frequency field
            contribution_frequency: dto.contributionFrequency,

            cycle_length: dto.cycleLength,

            // Daily and weekly groups don't use a monthly payout day.
            payout_day:
              dto.contributionFrequency === contribution_frequency.MONTHLY
                ? dto.payoutDay!
                : null,

            pool_account_number: null,
            pool_account_name: `Thriftly - ${dto.groupName}`.slice(0, 255),

            // This is an internal group pool, not a Paystack bank account.
            pool_bank_name: null,

            pool_reference: reference,
            pool_balance: 0.0,
          },
        });

        // Automatically add the group creator as its admin member.
        await tx.group_members.create({
          data: {
            group_id: group.id,
            user_id: dto.adminId,
            trust_score: 100,
          },
        });

        this.logger.log(
          `[GROUP CREATED] "${group.group_name}" with ${dto.contributionFrequency} contributions. Reference: ${reference}`,
        );

        return group;
      });
    } catch (error: any) {
      this.logger.error(
        `Failed to create group "${dto.groupName}": ${error.message}`,
      );

      throw new InternalServerErrorException('Failed to initialize group');
    }
  }

  /**
   * Initiates a group contribution through Paystack.
   */
  // async initiateGroupContribution(dto: {
  //   groupId: string;
  //   userId: string;
  //   email: string;
  //   amount: number;
  // }) {
  //   const group = await this.prisma.groups.findUnique({
  //     where: { id: dto.groupId },
  //   });

  //   if (!group) {
  //     throw new NotFoundException('Group not found');
  //   }

  //   if (dto.amount <= 0) {
  //     throw new BadRequestException(
  //       'Contribution amount must be greater than zero',
  //     );
  //   }

  //   const reference = `GRP_${dto.groupId.replace(/-/g, '').slice(0, 12)}_${Date.now()}`;

  //   const payment = await this.paystackService.initializeTransaction({
  //     email: dto.email,
  //     amount: dto.amount,
  //     reference,
  //     callback_url: process.env.PAYSTACK_CALLBACK_URL,
  //     metadata: {
  //       groupId: dto.groupId,
  //       userId: dto.userId,
  //       type: 'group_contribution',
  //     },
  //   });

  //   await this.prisma.transactions.create({
  //     data: {
  //       group_id: dto.groupId,
  //       user_id: dto.userId,
  //       reference,
  //       amount: dto.amount,
  //       direction: 'INFLOW',
  //       status: 'PENDING',
  //       channel: 'PAYSTACK',
  //       metadata: {
  //         groupId: dto.groupId,
  //         userId: dto.userId,
  //         type: 'group_contribution',
  //       },
  //     },
  //   });

  //   return {
  //     reference,
  //     authorization_url: payment.authorization_url,
  //     access_code: payment.access_code,
  //   };
  // }

  async getMyGroups(userId: string) {
    return this.prisma.groups.findMany({
      where: {
        group_members: {
          some: {
            user_id: userId,
          },
        },
      },
      select: {
        id: true,
        group_name: true,
        admin_id: true,
        contribution_amount: true,
        contribution_frequency: true,
        cycle_length: true,
        payout_day: true,
        pool_balance: true,
        _count: {
          select: {
            group_members: true,
          },
        },
      },
    });
  }

  /**
   * Retrieves group details and its members.
   */
  async getGroupDetails(groupId: string) {
    const group = await this.prisma.groups.findUnique({
      where: { id: groupId },
      include: {
        group_members: true,
      },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    return group;
  }

  async contributeFromWallet(dto: { groupId: string; userId: string }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. Check that the group exists
        const group = await tx.groups.findUnique({
          where: { id: dto.groupId },
        });

        if (!group) {
          throw new NotFoundException('Group not found');
        }

        // 2. Check that the user belongs to the group
        const membership = await tx.group_members.findUnique({
          where: {
            group_id_user_id: {
              group_id: dto.groupId,
              user_id: dto.userId,
            },
          },
        });

        if (!membership) {
          throw new BadRequestException('You are not a member of this group');
        }

        // 3. Get the required contribution from the group
        const amount = new Prisma.Decimal(group.contribution_amount);

        if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
          throw new BadRequestException('Invalid group contribution amount');
        }

        // 4. Find the member's personal wallet
        const wallet = await tx.wallets.findUnique({
          where: { user_id: dto.userId },
        });

        if (!wallet) {
          throw new NotFoundException(
            'Personal wallet not found. Please set up your wallet first.',
          );
        }

        // 5. Debit the wallet only if it has enough money
        const debit = await tx.wallets.updateMany({
          where: {
            user_id: dto.userId,
            balance: {
              gte: amount,
            },
          },
          data: {
            balance: {
              decrement: amount,
            },
          },
        });

        if (debit.count !== 1) {
          throw new BadRequestException('Insufficient wallet balance');
        }

        // 6. Credit the group pool
        const updatedGroups = await tx.$executeRaw`
        UPDATE "public"."groups"
        SET "pool_balance" = COALESCE("pool_balance", 0) + ${amount}
        WHERE "id" = ${dto.groupId}::uuid
      `;

        if (updatedGroups !== 1) {
          throw new NotFoundException('Group could not be credited');
        }

        // 7. Record the successful transfer
        const reference = `CONTRIB_${randomUUID()}`;

        const transaction = await tx.transactions.create({
          data: {
            user_id: dto.userId,
            group_id: dto.groupId,
            reference,
            amount,
            currency: 'NGN',
            // direction: 'TRANSFER',
            direction: 'OUTFLOW',
            channel: 'INTERNAL_WALLET',
            status: 'SUCCESS',
            metadata: {
              type: 'group_contribution',
              source: 'personal_wallet',
            },
          },
        });

        return {
          message: 'Group contribution successful',
          reference,
          amount: amount.toString(),
          transaction,
        };
      });
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      this.logger.error(
        'Failed to process group contribution',
        error instanceof Error ? error.stack : String(error),
      );

      throw new InternalServerErrorException(
        'Failed to process group contribution',
      );
    }
  }
}
