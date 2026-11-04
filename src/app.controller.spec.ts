import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return the app health message', () => {
      expect(appController.getHello()).toBe('Hello from thrifly fintech server...');
    });
  });

  describe('health', () => {
    it('should return the backend health payload', () => {
      expect(appController.getHealth()).toMatchObject({
        status: 'ok',
        message: 'Thriftly backend is running',
      });
      expect(appController.getHealth().timestamp).toBeTypeOf('string');
    });
  });
});
