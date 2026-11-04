import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  app.setGlobalPrefix('api');

  app.use(
    express.json({
      verify: (req, _res, buffer) => {
        (req as any).rawBody = buffer;
      },
    }),
  );

  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });


  await app.listen(process.env.PORT || 5000, '0.0.0.0');
  console.log(`Application is running on port ${process.env.PORT || 5000}`);
}
await bootstrap();
