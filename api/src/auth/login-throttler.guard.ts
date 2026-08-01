import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerRequest } from '@nestjs/throttler';
import type { Request } from 'express';

// Two limiters guard POST /auth/login:
//   - `ip`    — 5 attempts / minute / IP
//   - `phone` — 10 attempts / hour / phone number
//
// Both are in-process — no Redis in v1 (phase-1.md §4). Behind Traefik in
// production, `req.ip` is the real client because main.ts sets
// trust proxy = loopback. Multiple api instances would each hold their own
// counter, which is fine at the single-VPS scale we deploy at.
//
// getTracker() takes only the request in throttler v6, so the way to
// build a per-throttler key is to override handleRequest and stash the
// key on the request under a per-throttler property before delegating.
// The base class's default getTracker then reads that property back out.

@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected override handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const req = requestProps.context.switchToHttp().getRequest<Request>();
    const throttlerName = requestProps.throttler.name;

    let tracker: string;
    if (throttlerName === 'phone') {
      const body = req.body as { phone?: unknown } | undefined;
      const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
      tracker = phone ? `phone:${phone}` : `phone:unparseable:${req.ip ?? 'x'}`;
    } else {
      tracker = `ip:${req.ip ?? 'unknown'}`;
    }

    // Store the tracker under the property the base handleRequest will
    // read via getTracker. Using `req` as the storage bag keeps the
    // per-request scope tight.
    (req as unknown as { __throttlerTracker?: string }).__throttlerTracker = tracker;
    return super.handleRequest(requestProps);
  }

  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const tracker = (req as { __throttlerTracker?: string }).__throttlerTracker;
    if (tracker) return Promise.resolve(tracker);
    // Fallback: unnamed throttler or getTracker called outside our path.
    const request = req as unknown as Request;
    return Promise.resolve(`ip:${request.ip ?? 'unknown'}`);
  }
}
