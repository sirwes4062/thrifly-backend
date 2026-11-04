import {
  Body,
  Controller,
  Get,
  Headers,
  InternalServerErrorException,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { WalletsService } from './wallets.service.js';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard.js';

@Controller('wallets')
@UseGuards(SupabaseAuthGuard)
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Post('provision')
  async setupWallet(
    @Headers('authorization') authorization: string | undefined,
    @Body()
    body: {
      userId?: string;
      fullName?: string;
      phone?: string;
      email?: string;
    },
  ) {
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice(7).trim()
      : undefined;

    if (!token) {
      throw new UnauthorizedException(
        'A valid Supabase bearer token is required to provision a wallet.',
      );
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new InternalServerErrorException(
        'Supabase authentication is not configured for wallet provisioning.',
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      throw new UnauthorizedException(
        'Invalid or expired Supabase token. Please sign in again.',
      );
    }

    const fullName =
      (
        body.fullName ||
        (data.user.user_metadata as any)?.username ||
        'User'
      ).trim() || 'User';

    return this.walletsService.provisionUserWallet({
      userId: data.user.id,
      fullName,
      phone: body.phone || '',
      email: data.user.email || body.email || '',
    });
  }

  // @UseGuards(SupabaseAuthGuard)
  // @Post('topup/initiate')
  // async initiateTopUp(
  //   @Body() body: { userId: string; email: string; amount: number },
  // ) {
  //   return this.walletsService.initiateTopUp(body);
  // }

  @UseGuards(SupabaseAuthGuard)
  @Post('topup/initiate')
  async initiateTopUp(@Body() body: { amount: number }, @Req() req: any) {
    const userId = req.user?.id;
    const email = req.user?.email;

    if (!userId) {
      throw new UnauthorizedException('Please sign in to fund your wallet.');
    }

    if (!email) {
      throw new UnauthorizedException(
        'Your account email is required to fund your wallet.',
      );
    }

    return this.walletsService.initiateTopUp({
      userId,
      email,
      amount: Number(body.amount),
    });
  }

  @UseGuards(SupabaseAuthGuard)
  @Get('me')
  async getMyWallet(@Req() req: any) {
    const userId = req.user?.id || req.headers['x-user-id'];
    return this.walletsService.getWallet(userId);
  }
}
