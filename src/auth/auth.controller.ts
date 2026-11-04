import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('otp/send')
  async sendOtp(
    @Body()
    body: {
      channel: 'email' | 'sms';
      contact: string;
      username?: string;
    },
  ) {
    return this.authService.sendOtp(body);
  }

  @Post('otp/verify')
  async verifyOtp(
    @Body() body: { channel: 'email' | 'sms'; contact: string; otp: string },
  ) {
    return this.authService.verifyOtp(body);
  }

  @Post('signup')
  async signup(
    @Body()
    body: {
      username: string;
      email?: string;
      phone?: string;
      password: string;
      otp: string;
      verificationMode: 'email' | 'sms';
    },
  ) {
    return this.authService.signup(body);
  }

  @Post('signin')
  async signin(
    @Body()
    body: {
      identifier: string;
      password: string;
      mode: 'email' | 'phone';
    },
  ) {
    return this.authService.signin(body);
  }

  // @Post('forgot-password')
  // async forgotPassword(
  //   @Body() body: { identifier: string; mode?: 'email' | 'phone' },
  // ) {
  //   return this.authService.forgotPassword(body);
  // }

  // @Post('reset-password')
  // async resetPassword(
  //   @Body()
  //   body: {
  //     identifier: string;
  //     otp: string;
  //     newPassword: string;
  //     mode?: 'email' | 'phone';
  //   },
  // ) {
  //   return this.authService.resetPassword(body);
  // }
}
