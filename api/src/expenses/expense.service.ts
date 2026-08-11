import { Injectable } from '@nestjs/common';
import { Prisma, type Expense } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { InactiveCurrencyError } from '../common/errors/ledger.errors.js';
import { Decimal } from '../common/money.js';
import { PrismaService } from '../common/prisma.service.js';
import { CurrencyNotFoundError } from '../currencies/errors.js';
import { ExpenseCategoryNotFoundError } from '../expense-categories/errors.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { CreateExpenseDto } from './dto/create-expense.dto.js';
import { InactiveExpenseCategoryError } from './errors.js';

// Expenses reduce net profit with no P&L implication (no disposalValueMru).
// LedgerService.apply handles: currency-active guard, balance sufficiency
// (D-014), requires_note enforcement (D-020).

@Injectable()
export class ExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async create(actorId: string, dto: CreateExpenseDto, ip: string | null): Promise<Expense> {
    return this.prisma.$transaction(async (tx) => {
      // --- 1. Validate expense category ------------------------------------
      const category = await tx.expenseCategory.findUnique({
        where: { id: dto.expenseCategoryId },
      });
      if (!category) throw new ExpenseCategoryNotFoundError(dto.expenseCategoryId);
      if (!category.isActive) throw new InactiveExpenseCategoryError(dto.expenseCategoryId);

      // --- 2. Validate currency --------------------------------------------
      const currency = await tx.currency.findUnique({ where: { id: dto.currencyId } });
      if (!currency) throw new CurrencyNotFoundError(dto.currencyId);
      if (!currency.isActive) throw new InactiveCurrencyError(currency.code);

      const amount = new Decimal(dto.amount);
      const transactionDate = dto.transactionDate ? new Date(dto.transactionDate) : new Date();

      // --- 3. Insert expense row -------------------------------------------
      const expense = await tx.expense.create({
        data: {
          expenseCategoryId: dto.expenseCategoryId,
          currencyId: dto.currencyId,
          amount: new Prisma.Decimal(amount.toString()),
          paymentMethodId: dto.paymentMethodId,
          paymentMethodNote: dto.paymentMethodNote ?? null,
          description: dto.description,
          status: 'CONFIRMED',
          transactionDate,
          createdByUserId: actorId,
        },
      });

      // --- 4. Apply ledger DEBIT (disposal at cost, pnl = 0) ---------------
      await this.ledger.apply(tx, [
        {
          currencyId: dto.currencyId,
          direction: 'DEBIT',
          amount,
          sourceType: 'expense',
          sourceId: expense.id,
          paymentMethodId: dto.paymentMethodId,
          note: dto.paymentMethodNote ?? null,
          transactionDate,
          description: `Expense — ${category.name}`,
          createdByUserId: actorId,
        },
      ]);

      // --- 5. Audit --------------------------------------------------------
      await this.audit.log(tx, {
        action: 'expense_created',
        actorUserId: actorId,
        entityType: 'expense',
        entityId: expense.id,
        after: {
          expenseCategoryId: dto.expenseCategoryId,
          currencyCode: currency.code,
          amount: amount.toString(),
          description: dto.description,
        },
        ip,
      });

      return expense;
    });
  }
}
