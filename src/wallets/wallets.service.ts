import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaystackService } from '../integrations/paystack/paystack.service.js';

export interface ProvisionWalletDto {
  userId: string;
  fullName: string;
  phone: string;
  email?: string;
}

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystackService: PaystackService,
  ) {}

  /**
   * Create the user wallet record that Paystack transactions will credit.
   */
  async provisionUserWallet(dto: ProvisionWalletDto) {
    const existingWallet = await this.prisma.wallets.findUnique({
      where: { user_id: dto.userId },
    });

    if (existingWallet) {
      return existingWallet;
    }

    const sanitizedId = dto.userId.replace(/-/g, '').slice(0, 8);
    const reference = `W_${sanitizedId}_${Date.now().toString().slice(-4)}`;

    // 1. Ensure the parent profile exists so the foreign key constraint is satisfied

    try {
      return await this.prisma.wallets.create({
        data: {
          user_id: dto.userId,
          account_number: `WAL-${sanitizedId}`.slice(0, 10),
          account_name: dto.fullName,
          bank_name: 'Paystack',
          reference,
          balance: 0.0,
        },
      });
    } catch (error: any) {
      this.logger.error(
        `Error provisioning wallet for user ${dto.userId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to provision dedicated wallet account',
      );
    }
  }

  async initiateTopUp(dto: { userId: string; email: string; amount: number }) {
    const wallet = await this.prisma.wallets.findUnique({
      where: { user_id: dto.userId },
    });

    if (!wallet) {
      throw new InternalServerErrorException('Wallet not found for user');
    }

    const reference = `WAL_${dto.userId.replace(/-/g, '')}_${Date.now()}`;

    const payment = await this.paystackService.initializeTransaction({
      email: dto.email,
      amount: dto.amount,
      reference,
      callback_url: process.env.PAYSTACK_CALLBACK_URL,
      metadata: {
        userId: dto.userId,
        walletId: wallet.id,
        type: 'wallet_topup',
      },
    });

    await this.prisma.transactions.create({
      data: {
        user_id: dto.userId,
        reference,
        amount: dto.amount,
        direction: 'INFLOW',
        status: 'PENDING',
        channel: 'PAYSTACK',
        metadata: {
          userId: dto.userId,
          walletId: wallet.id,
          type: 'wallet_topup',
        },
      },
    });

    return {
      reference,
      authorization_url: payment.authorization_url,
      access_code: payment.access_code,
    };
  }

  async getWallet(userId: string) {
    return this.prisma.wallets.findUnique({
      where: { user_id: userId },
    });
  }
}
