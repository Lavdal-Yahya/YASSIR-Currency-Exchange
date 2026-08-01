import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError } from './domain.error.js';

// Every error becomes the same wire shape:
//   { code, i18nKey, message, data?, requestId? }
// Stack traces never reach the client (spec §42) — they land in the
// server log, correlated by an ephemeral requestId that also goes on
// the response so a bug report can be joined to logs.

export interface ErrorPayload {
  code: string;
  i18nKey: string;
  message: string;
  data?: Record<string, unknown>;
  requestId?: string;
}

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = generateRequestId();

    if (exception instanceof DomainError) {
      this.logger.warn(`${exception.code} @ ${req.method} ${req.url} rid=${requestId}`);
      res.status(exception.status).json({
        code: exception.code,
        i18nKey: exception.i18nKey,
        message: exception.message,
        ...(Object.keys(exception.data).length ? { data: exception.data } : {}),
        requestId,
      } satisfies ErrorPayload);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload = normalizeHttpException(status, body, requestId);
      // Client errors are not stack-trace worthy; server errors are.
      if (status >= 500) {
        this.logger.error(
          `HttpException ${status} @ ${req.method} ${req.url} rid=${requestId}`,
          exception.stack,
        );
      } else {
        this.logger.warn(`HttpException ${status} @ ${req.method} ${req.url} rid=${requestId}`);
      }
      res.status(status).json(payload);
      return;
    }

    // Anything else is a bug. Log the stack, return a generic 500.
    const err = exception as Error;
    this.logger.error(
      `Unhandled error @ ${req.method} ${req.url} rid=${requestId}: ${err?.message ?? String(exception)}`,
      err?.stack,
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'internal',
      i18nKey: 'error.internal',
      message: 'Something went wrong.',
      requestId,
    } satisfies ErrorPayload);
  }
}

function normalizeHttpException(status: number, body: unknown, requestId: string): ErrorPayload {
  // Nest's own HttpException includes helpful codes we don't want to
  // leak (`statusCode`, `error` = "Bad Request"). Rewrite to the domain
  // shape so the frontend has one contract.
  const defaults: Record<number, Pick<ErrorPayload, 'code' | 'i18nKey' | 'message'>> = {
    400: { code: 'validation', i18nKey: 'error.validation', message: 'Bad request.' },
    401: { code: 'unauthorized', i18nKey: 'error.unauthorized', message: 'Unauthorized.' },
    403: { code: 'forbidden', i18nKey: 'error.forbidden', message: 'Forbidden.' },
    429: {
      code: 'too_many_requests',
      i18nKey: 'error.too_many_requests',
      message: 'Too many attempts.',
    },
  };
  const base = defaults[status] ?? {
    code: 'internal',
    i18nKey: 'error.internal',
    message: 'Something went wrong.',
  };

  // If the caller passed a structured body ({ code, i18nKey, ... }), respect it.
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    if (typeof b.code === 'string' && typeof b.i18nKey === 'string') {
      return {
        code: b.code,
        i18nKey: b.i18nKey,
        message: typeof b.message === 'string' ? b.message : base.message,
        ...(b.data && typeof b.data === 'object'
          ? { data: b.data as Record<string, unknown> }
          : {}),
        requestId,
      };
    }
    // class-validator ships an array under `message` — surface it as `data.errors`.
    if (Array.isArray(b.message)) {
      return {
        ...base,
        code: 'validation',
        i18nKey: 'error.validation',
        data: { errors: b.message },
        requestId,
      };
    }
  }

  return { ...base, requestId };
}

function generateRequestId(): string {
  // 12 hex chars — plenty for correlation without dragging in a uuid dep
  // for a field that lives at most a request.
  return Math.random().toString(16).slice(2, 14).padStart(12, '0');
}
