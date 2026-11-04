import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello from thrifly fintech server...';
  }

  getHealth() {
    return {
      status: 'ok',
      message: 'Thriftly backend is running',
      timestamp: new Date().toISOString(),
    };
  }
}
