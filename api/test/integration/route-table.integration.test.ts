// Route-table introspection (phase-1.md §3, §6, §7 DoD).
//
// Boots the real Nest app, walks the container's discovered controllers
// and their handler methods, and asserts each has exactly one of:
//   - @Public                        (public, no session)
//   - @Authenticated                 (session, any user)
//   - @RequirePermission(...codes)   (session + at least one code)
//
// Any handler with none — or with more than one — fails the test with a
// helpful message naming the controller and method. This is what makes
// "fail closed on missing decorator" a compile-time guarantee rather
// than a runtime hope.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator.js';
import { IS_AUTHENTICATED_KEY } from '../../src/common/decorators/authenticated.decorator.js';
import { REQUIRED_PERMISSIONS_KEY } from '../../src/common/decorators/require-permission.decorator.js';

interface RouteInfo {
  controller: string;
  method: string;
  path: string;
  hasPublic: boolean;
  hasAuthenticated: boolean;
  requiredPermissions: string[] | undefined;
}

let app: INestApplication;
let routes: RouteInfo[];

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();

  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);

  routes = [];
  for (const wrapper of discovery.getControllers()) {
    const { instance } = wrapper;
    if (!instance) continue;
    const prototype = Object.getPrototypeOf(instance);
    const metatype = wrapper.metatype;
    if (!metatype) continue;
    const controllerPath = reflector.get<string>('path', metatype) ?? '';

    for (const methodName of scanner.getAllMethodNames(prototype)) {
      const handler = prototype[methodName];
      const routePath = reflector.get<string>('path', handler) ?? '';
      // Only include actual route handlers — they have the 'method' metadata.
      const method = reflector.get<number | undefined>('method', handler);
      if (method === undefined) continue;

      routes.push({
        controller: wrapper.metatype?.name ?? '<anonymous>',
        method: methodName,
        path: `${controllerPath}/${routePath}`.replace(/\/+/g, '/'),
        hasPublic: !!reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
          handler,
          metatype,
        ]),
        hasAuthenticated: !!reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED_KEY, [
          handler,
          metatype,
        ]),
        requiredPermissions: reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [
          handler,
          metatype,
        ]),
      });
    }
  }
});

afterAll(async () => {
  await app.close();
});

describe('route table', () => {
  it('discovered at least the P1 endpoints', () => {
    const paths = routes.map((r) => `${r.controller}.${r.method}`).sort();
    expect(paths).toEqual(
      expect.arrayContaining([
        'AuthController.login',
        'AuthController.logout',
        'AuthController.me',
        'HealthController.check',
      ]),
    );
  });

  it('every handler declares exactly one of @Public / @Authenticated / @RequirePermission', () => {
    const violations: string[] = [];

    for (const route of routes) {
      const hasPerm = Array.isArray(route.requiredPermissions) && route.requiredPermissions.length > 0;
      const marks = [route.hasPublic, route.hasAuthenticated, hasPerm].filter(Boolean).length;

      if (marks === 0) {
        violations.push(
          `${route.controller}.${route.method} (${route.path}) — no @Public, @Authenticated, or @RequirePermission`,
        );
      } else if (marks > 1) {
        violations.push(
          `${route.controller}.${route.method} (${route.path}) — has ${marks} of {@Public, @Authenticated, @RequirePermission}, expected exactly one`,
        );
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Route auth-mode violations:\n${violations.map((v) => `  - ${v}`).join('\n')}`,
      );
    }
  });
});
