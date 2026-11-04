import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PaystackService } from './paystack.service.js';

@Controller('webhooks/paystack')
export class PaystackWebhookController {
  private readonly logger = new Logger(PaystackWebhookController.name);

  constructor(
    private readonly paystackService: PaystackService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: Request,
    @Body() payload: any,
    @Headers('x-paystack-signature') signature?: string,
  ) {
    const rawBody =
      (req as any).rawBody?.toString('utf8') || JSON.stringify(payload);

    if (!this.paystackService.verifyWebhookSignature(rawBody, signature)) {
      this.logger.error('Paystack webhook signature verification failed');
      throw new BadRequestException('Invalid Paystack signature');
    }

    const event = payload?.event;
    const data = payload?.data;

    if (!event || !data) {
      return { status: 'ignored', message: 'Missing webhook payload' };
    }

    if (event === 'charge.success') {
      const reference = data.reference;
      const metadata = data.metadata || {};

      this.logger.log(`Paystack success received for reference: ${reference}`);

      // Idempotency: only skip if this webhook was already fully processed
      const existingTx = await this.prisma.transactions.findUnique({
        where: { reference },
      });

      if (existingTx && existingTx.status === 'SUCCESS') {
        this.logger.log(`Already processed reference: ${reference}`);
        return { status: 'ok', message: 'Already processed' };
      }

      const amount = Number(data.amount || 0) / 100;

      if (metadata.userId) {
        const wallet = await this.prisma.wallets.findUnique({
          where: { user_id: metadata.userId },
        });

        if (wallet) {
          await this.prisma.$transaction(async (tx) => {
            const updatedWallet = await tx.wallets.update({
              where: { id: wallet.id },
              data: { balance: { increment: amount } },
            });

            // Update existing PENDING transaction to SUCCESS, or create if none exists
            if (existingTx) {
              await tx.transactions.update({
                where: { id: existingTx.id },
                data: {
                  status: 'SUCCESS',
                  metadata: payload,
                },
              });
            } else {
              await tx.transactions.create({
                data: {
                  user_id: metadata.userId,
                  reference,
                  amount,
                  direction: 'INFLOW',
                  status: 'SUCCESS',
                  channel: 'PAYSTACK',
                  metadata: payload,
                },
              });
            }

            // this.logger.log(
            //   `Wallet credited for user ${metadata.userId}: ${updatedWallet.balance}`,
            // );
          });
        }
      }

      if (metadata.groupId) {
        const group = await this.prisma.groups.findUnique({
          where: { id: metadata.groupId },
        });

        if (group) {
          await this.prisma.$transaction(async (tx) => {
            const updatedGroup = await tx.groups.update({
              where: { id: group.id },
              data: { pool_balance: { increment: amount } },
            });

            // Update existing PENDING transaction to SUCCESS, or create if none exists
            if (existingTx) {
              await tx.transactions.update({
                where: { id: existingTx.id },
                data: {
                  status: 'SUCCESS',
                  metadata: payload,
                },
              });
            } else {
              await tx.transactions.create({
                data: {
                  group_id: metadata.groupId,
                  reference,
                  amount,
                  direction: 'INFLOW',
                  status: 'SUCCESS',
                  channel: 'PAYSTACK',
                  metadata: payload,
                },
              });
            }

            // this.logger.log(
            //   `Group pool credited for group ${metadata.groupId}: ${updatedGroup.pool_balance}`,
            // );
          });
        }
      }
    }

    return { status: 'ok' };
  }
}
