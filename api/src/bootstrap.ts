import { ValidationPipe, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { DomainExceptionFilter } from './common/errors/exception.filter.js';

// Everything main.ts and every integration test needs to do to an
// INestApplication before it starts serving requests. Keeping this in
// one place means the test doesn't drift from production behaviour —
// same middleware, same pipes, same filter, same prefix.
export function configureApp(app: INestApplication): INestApplication {
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new DomainExceptionFilter());

  const httpAdapter = app.getHttpAdapter();
  const instance = httpAdapter.getInstance();
  if (typeof instance.set === 'function') {
    instance.set('trust proxy', 'loopback, linklocal, uniquelocal');
  }
  return app;
}
