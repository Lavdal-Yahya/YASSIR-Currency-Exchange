import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type StrategyOptionsWithoutRequest } from 'passport-jwt';
import type { Request } from 'express';
import type { Env } from '../config/env.schema.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';

interface JwtPayload {
  sub: string;
  phone: string;
  iat?: number;
  exp?: number;
}

function cookieExtractor(cookieName: string): (req: Request) => string | null {
  return (req) => {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    return cookies?.[cookieName] ?? null;
  };
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<Env, true>) {
    const secret = config.get('JWT_SECRET', { infer: true });
    const cookieName = config.get('COOKIE_NAME', { infer: true });
    const opts: StrategyOptionsWithoutRequest = {
      jwtFromRequest: cookieExtractor(cookieName),
      secretOrKey: secret,
      ignoreExpiration: false,
    };
    super(opts);
  }

  validate(payload: JwtPayload): AuthUser {
    return { id: payload.sub, phone: payload.phone };
  }
}
