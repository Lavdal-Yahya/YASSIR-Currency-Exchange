import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AppConfigModule } from './config/config.module.js';
import { PrismaModule } from './common/prisma.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { CurrenciesModule } from './currencies/currencies.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { PaymentMethodsModule } from './payment-methods/payment-methods.module.js';
import { ContactsModule } from './contacts/contacts.module.js';
import { ExpenseCategoriesModule } from './expense-categories/expense-categories.module.js';
import { LedgerModule } from './ledger/ledger.module.js';
import { OpeningsModule } from './openings/openings.module.js';
import { TradesModule } from './trades/trades.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { ExpensesModule } from './expenses/expenses.module.js';
import { ReversalModule } from './reversal/reversal.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { HealthModule } from './health/health.module.js';

// Root module. Every feature module lives inside a folder and is
// registered here. Feature modules must not import each other's
// services — cross-module needs go through a published service
// interface via a @Global module (PrismaModule, AuditModule) or,
// better, don't exist. Architecture §2.
@Module({
  imports: [
    // DiscoveryModule powers the route-table introspection test (P1-07)
    // which walks every controller and asserts each handler has one of
    // @Public / @Authenticated / @RequirePermission. Zero runtime cost
    // in production; keeping it imported keeps the guarantee available.
    DiscoveryModule,
    AppConfigModule,
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    CurrenciesModule,
    SettingsModule,
    PaymentMethodsModule,
    ContactsModule,
    ExpenseCategoriesModule,
    LedgerModule,
    OpeningsModule,
    TradesModule,
    PaymentsModule,
    ExpensesModule,
    ReversalModule,
    ReportsModule,
    HealthModule,
  ],
})
export class AppModule {}
