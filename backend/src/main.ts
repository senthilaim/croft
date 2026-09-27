import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  // rawBody: true -- the Stripe webhook route (billing/webhook.controller.ts) needs the untouched
  // request body to verify Stripe's signature; every other route is unaffected and still gets the
  // normally-parsed JSON body.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({ origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000', credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  await app.listen(process.env.PORT ?? 4000);
}
await bootstrap();
