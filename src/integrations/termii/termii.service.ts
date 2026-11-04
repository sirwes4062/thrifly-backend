import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class TermiiService {
  private readonly logger = new Logger(TermiiService.name);
  private readonly apiKey = process.env.TERMII_API_KEY?.trim();
  private readonly baseUrl =
    process.env.TERMII_BASE_URL?.trim() || 'https://api.ng.termii.com';

  private ensureConfig() {
    if (!this.apiKey) {
      throw new Error(
        'TERMII_API_KEY is missing. Add your Termii API key to the backend .env file.',
      );
    }
  }

  private normalizePhoneNumber(value: string): string {
    const digits = value.replace(/\D/g, '');
    if (!digits) return value;
    if (digits.startsWith('0') && digits.length === 11) {
      return `234${digits.slice(1)}`;
    }
    if (digits.startsWith('234')) {
      return digits;
    }
    return digits;
  }

  /**
   * 1. Send OTP using Termii's Token Engine
   * Bypasses the need for an approved custom Sender ID.
   */
  async sendOtpSms({ to }: { to: string }): Promise<{ pinId: string }> {
    this.ensureConfig();

    const formattedTo = this.normalizePhoneNumber(to);
    const pinPlaceholder = '< 1234 >';

    const payload = {
      api_key: this.apiKey,
      message_type: 'NUMERIC',
      to: formattedTo,
      from: 'N-Alert', // Termii's shared system identity
      channel: 'dnd', // Delivers across Nigerian lines with DND enabled
      pin_attempts: 5,
      pin_time_to_live: 10, // 10 minutes expiry
      pin_length: 6,
      pin_placeholder: pinPlaceholder,
      message_text: `Your Thriftly verification code is ${pinPlaceholder}. Valid for 10 minutes.`,
    };

    try {
      const response = await axios.post(
        `${this.baseUrl}/api/sms/otp/send`,
        payload,
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );

      // Termii responds with { pinId: '...', to: '...', smsStatus: 'Message Sent' }
      return { pinId: response.data?.pinId };
    } catch (err: any) {
      const errorMsg = err.response?.data?.message || err.message;
      this.logger.error(`Termii OTP dispatch failed: ${errorMsg}`);
      throw new BadRequestException(
        errorMsg || 'Failed to dispatch verification code',
      );
    }
  }

  /**
   * 2. Verify OTP using Termii's Verification Route
   */
  async verifyOtpToken({
    pinId,
    pin,
  }: {
    pinId: string;
    pin: string;
  }): Promise<boolean> {
    this.ensureConfig();

    if (!pinId || !pin) {
      throw new BadRequestException(
        'Pin ID and verification code are required',
      );
    }

    const payload = {
      api_key: this.apiKey,
      pin_id: pinId,
      pin: pin.trim(),
    };

    try {
      const response = await axios.post(
        `${this.baseUrl}/api/sms/otp/verify`,
        payload,
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );

      // Termii returns { verified: true, msisdn: '...' } or { verified: false }
      return (
        response.data?.verified === true || response.data?.verified === 'True'
      );
    } catch (err: any) {
      const errorMsg = err.response?.data?.message || 'Invalid or expired OTP';
      this.logger.warn(`OTP verification rejected: ${errorMsg}`);
      throw new BadRequestException(errorMsg);
    }
  }
}
