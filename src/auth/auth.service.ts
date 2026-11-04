import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { TermiiService } from '../integrations/termii/termii.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletsService } from '../wallets/wallets.service.js';

type VerificationChannel = 'email' | 'sms';
type ContactMode = 'email' | 'phone';

type StoredUser = {
  id: string;
  username: string;
  email?: string;
  phone?: string;
  passwordHash: string;
  createdAt: Date;
};

@Injectable()
export class AuthService {
  // Key: "sms:23480...", Value: { pinId: string, expiresAt: number }
  private readonly otpStore = new Map<
    string,
    { pinId: string; expiresAt: number }
  >();
  private readonly userStore = new Map<string, StoredUser>();

  constructor(
    private readonly termiiService: TermiiService,
    private readonly prisma: PrismaService,
    private readonly walletsService: WalletsService,
  ) {}

  private normalizeContact(contact: string): string {
    return contact.trim();
  }

  private getOtpKey(channel: VerificationChannel, contact: string): string {
    return `${channel}:${this.normalizeContact(contact).toLowerCase()}`;
  }

  private getUserLookupKey(identifier: string, mode?: ContactMode): string {
    const normalized = identifier.trim();
    if (mode === 'phone') return `phone:${normalized}`;
    if (mode === 'email' || normalized.includes('@')) {
      return `email:${normalized.toLowerCase()}`;
    }
    return `phone:${normalized}`;
  }

  private findUserByIdentifier(identifier: string, mode?: ContactMode) {
    const lookupKey = this.getUserLookupKey(identifier, mode);

    for (const user of this.userStore.values()) {
      if (lookupKey === `email:${user.email?.toLowerCase()}`) return user;
      if (lookupKey === `phone:${user.phone}`) return user;
    }
    return undefined;
  }

  /**
   * Dispatches SMS using Termii's token engine and saves pinId
   */
  async sendOtp({
    channel,
    contact,
  }: {
    channel: VerificationChannel;
    contact: string;
    username?: string;
  }) {
    if (channel !== 'sms') {
      throw new BadRequestException(
        'Email verification is handled by Supabase. SMS OTP is the only backend OTP channel enabled.',
      );
    }

    const normalizedContact = this.normalizeContact(contact);
    if (!normalizedContact) {
      throw new BadRequestException('Contact number is required');
    }

    // Call Termii Token Engine: Termii generates code & delivers via shared route
    const { pinId } = await this.termiiService.sendOtpSms({
      to: normalizedContact,
    });

    const key = this.getOtpKey(channel, normalizedContact);
    this.otpStore.set(key, {
      pinId,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    return {
      success: true,
      message: 'SMS verification code sent successfully',
      otpReference: key,
    };
  }

  /**
   * Submits user's entered digits to Termii's verify endpoint
   */
  async verifyOtp({
    channel,
    contact,
    otp,
  }: {
    channel: VerificationChannel;
    contact: string;
    otp: string;
  }) {
    if (channel !== 'sms') {
      throw new BadRequestException(
        'Email verification is handled by Supabase. SMS OTP is the only backend OTP channel enabled.',
      );
    }

    const normalizedContact = this.normalizeContact(contact);
    const key = this.getOtpKey(channel, normalizedContact);
    const stored = this.otpStore.get(key);

    if (!stored) {
      throw new UnauthorizedException(
        'No active OTP found for this phone number',
      );
    }

    if (Date.now() > stored.expiresAt) {
      this.otpStore.delete(key);
      throw new UnauthorizedException(
        'OTP has expired. Please request a new code.',
      );
    }

    // Verify code with Termii
    const isValid = await this.termiiService.verifyOtpToken({
      pinId: stored.pinId,
      pin: otp,
    });

    if (!isValid) {
      throw new UnauthorizedException('Invalid OTP code');
    }

    // Clear record on successful verification
    this.otpStore.delete(key);

    return {
      verified: true,
      message: 'Phone number verified successfully',
    };
  }

  async signup(dto: {
    username: string;
    email?: string;
    phone?: string;
    password: string;
    otp?: string;
    verificationMode: 'email' | 'sms';
    supabaseUserId?: string;
  }) {
    const username = dto.username.trim();
    const email = dto.email?.trim().toLowerCase();
    const phone = dto.phone?.trim();
    const contact = dto.verificationMode === 'email' ? email : phone;

    if (!username) throw new BadRequestException('Username is required');
    if (!contact)
      throw new BadRequestException('Email or phone number is required');

    if (dto.verificationMode === 'email') {
      throw new BadRequestException(
        'Email sign-up is handled entirely by Supabase Auth. Authenticate with Supabase, then call /api/wallets/provision with a valid bearer token.',
      );
    }

    if (!dto.password || dto.password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }
    if (!phone) {
      throw new BadRequestException('Phone number is required');
    }
    if (!dto.otp) {
      throw new BadRequestException('OTP is required for SMS signup');
    }
    await this.verifyOtp({
      channel: 'sms',
      contact: phone,
      otp: dto.otp,
    });

    const userId = randomUUID();
    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user: StoredUser = {
      id: userId,
      username,
      email: undefined,
      phone,
      passwordHash,
      createdAt: new Date(),
    };

    await this.prisma.users.create({
      data: {
        id: userId,
        email: user.email ?? undefined,
        phone: user.phone ?? undefined,
        encrypted_password: user.passwordHash,
        raw_user_meta_data: {
          username: user.username,
          createdAt: user.createdAt.toISOString(),
        },
        is_sso_user: false,
      },
    });

    this.userStore.set(userId, user);
    if (user.phone) this.userStore.set(`phone:${user.phone}`, user);
    if (user.email)
      this.userStore.set(`email:${user.email.toLowerCase()}`, user);

    const wallet = await this.walletsService.provisionUserWallet({
      userId: user.id,
      fullName: user.username,
      phone: user.phone || '',
      email: user.email || '',
    });

    return {
      message: 'Signup successful. Wallet created.',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        phone: user.phone,
      },
      wallet,
      token: `demo-token-${user.id}`,
    };
  }

  async signin({
    identifier,
    password,
    mode,
  }: {
    identifier: string;
    password: string;
    mode: 'email' | 'phone';
  }) {
    const normalizedIdentifier = identifier.trim();

    const dbUser = await this.prisma.users.findFirst({
      where: {
        OR: [
          mode === 'email' || normalizedIdentifier.includes('@')
            ? { email: normalizedIdentifier.toLowerCase() }
            : { phone: normalizedIdentifier },
          mode === 'phone'
            ? { phone: normalizedIdentifier }
            : { email: normalizedIdentifier.toLowerCase() },
        ],
      },
    });

    let user: StoredUser | undefined = dbUser
      ? {
          id: dbUser.id,
          username:
            (dbUser.raw_user_meta_data as { username?: string } | null)
              ?.username || 'user',
          email: dbUser.email ?? undefined,
          phone: dbUser.phone ?? undefined,
          passwordHash: dbUser.encrypted_password ?? '',
          createdAt: dbUser.created_at ?? new Date(),
        }
      : undefined;

    if (!user) {
      user = this.findUserByIdentifier(identifier, mode);
    }

    if (!user) {
      throw new UnauthorizedException('Invalid email/phone or password');
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid email/phone or password');
    }

    return {
      message: 'Login successful',
      token: `demo-token-${user.id}`,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        phone: user.phone,
      },
    };
  }
}
