import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';

export interface PaystackInitializeResponse {
  authorization_url: string;
  access_code: string;
  reference: string;
}

@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);
  private readonly client: AxiosInstance;
  private readonly secretKey = process.env.PAYSTACK_SECRET_KEY;
  private readonly baseUrl =
    process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co';

  constructor() {
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${this.secretKey || ''}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async initializeTransaction(params: {
    email: string;
    amount: number;
    reference: string;
    callback_url?: string;
    metadata?: Record<string, any>;
  }): Promise<PaystackInitializeResponse> {
    if (!this.secretKey) {
      throw new InternalServerErrorException(
        'PAYSTACK_SECRET_KEY is not configured',
      );
    }

    try {
      const payload = {
        email: params.email,
        amount: Math.round(params.amount * 100),
        reference: params.reference,
        callback_url: params.callback_url,
        metadata: params.metadata || {},
      };

      const res = await this.client.post('/transaction/initialize', payload);

      if (!res.data?.status) {
        throw new Error(res.data?.message || 'Paystack initialization failed');
      }

      return res.data.data as PaystackInitializeResponse;
    } catch (error: any) {
      this.logger.error(
        `Paystack initialization failed: ${error.response?.data?.message || error.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to initialize Paystack transaction',
      );
    }
  }

  async verifyTransaction(reference: string) {
    if (!this.secretKey) {
      throw new InternalServerErrorException(
        'PAYSTACK_SECRET_KEY is not configured',
      );
    }

    try {
      const res = await this.client.get(
        `/transaction/verify/${encodeURIComponent(reference)}`,
      );

      if (!res.data?.status) {
        throw new Error(res.data?.message || 'Paystack verification failed');
      }

      return res.data.data;
    } catch (error: any) {
      this.logger.error(
        `Paystack verification failed: ${error.response?.data?.message || error.message}`,
      );
      throw new InternalServerErrorException('Failed to verify Paystack payment');
    }
  }

  verifyWebhookSignature(rawBody: string, signature?: string): boolean {
    if (!signature || !this.secretKey) {
      return false;
    }

    const incoming = signature.startsWith('sha512=')
      ? signature.slice(7)
      : signature;

    const expected = crypto
      .createHmac('sha512', this.secretKey)
      .update(rawBody)
      .digest('hex');

    return expected.toLowerCase() === incoming.toLowerCase();
  }
}