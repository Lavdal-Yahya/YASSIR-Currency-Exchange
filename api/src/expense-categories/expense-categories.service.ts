import { Injectable } from '@nestjs/common';
import type { ExpenseCategory } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../common/prisma.service.js';
import type { CreateExpenseCategoryDto } from './dto/create-expense-category.dto.js';
import type { UpdateExpenseCategoryDto } from './dto/update-expense-category.dto.js';
import { ExpenseCategoryNameTakenError, ExpenseCategoryNotFoundError } from './errors.js';

// ExpenseCategoriesService — lookup table for P5 expense rows.
// No `delete` — the DB REVOKE closes the back door and historical
// expense rows reference this by id.

@Injectable()
export class ExpenseCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(includeInactive = false): Promise<ExpenseCategory[]> {
    return this.prisma.expenseCategory.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async getById(id: string): Promise<ExpenseCategory> {
    const found = await this.prisma.expenseCategory.findUnique({ where: { id } });
    if (!found) throw new ExpenseCategoryNotFoundError(id);
    return found;
  }

  async create(
    actorId: string,
    dto: CreateExpenseCategoryDto,
    ip: string | null,
  ): Promise<ExpenseCategory> {
    return this.prisma.$transaction(async (tx) => {
      const name = dto.name.trim();
      const existing = await tx.expenseCategory.findUnique({ where: { name } });
      if (existing) throw new ExpenseCategoryNameTakenError(name);

      const created = await tx.expenseCategory.create({
        data: { name, isActive: dto.isActive ?? true },
      });

      await this.audit.log(tx, {
        action: 'expense_category_created',
        actorUserId: actorId,
        entityType: 'expense_category',
        entityId: created.id,
        after: { name: created.name, isActive: created.isActive },
        ip,
      });

      return created;
    });
  }

  async update(
    actorId: string,
    id: string,
    dto: UpdateExpenseCategoryDto,
    ip: string | null,
  ): Promise<ExpenseCategory> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.expenseCategory.findUnique({ where: { id } });
      if (!before) throw new ExpenseCategoryNotFoundError(id);

      if (dto.name !== undefined) {
        const name = dto.name.trim();
        if (name !== before.name) {
          const clash = await tx.expenseCategory.findUnique({ where: { name } });
          if (clash) throw new ExpenseCategoryNameTakenError(name);
        }
      }

      const updated = await tx.expenseCategory.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        },
      });

      if (updated.name !== before.name) {
        await this.audit.log(tx, {
          action: 'expense_category_updated',
          actorUserId: actorId,
          entityType: 'expense_category',
          entityId: id,
          before: { name: before.name },
          after: { name: updated.name },
          ip,
        });
      }

      return updated;
    });
  }

  async deactivate(actorId: string, id: string, ip: string | null): Promise<ExpenseCategory> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.expenseCategory.findUnique({ where: { id } });
      if (!current) throw new ExpenseCategoryNotFoundError(id);
      if (!current.isActive) return current;

      const updated = await tx.expenseCategory.update({
        where: { id },
        data: { isActive: false },
      });

      await this.audit.log(tx, {
        action: 'expense_category_deactivated',
        actorUserId: actorId,
        entityType: 'expense_category',
        entityId: id,
        before: { isActive: true },
        after: { isActive: false },
        ip,
      });

      return updated;
    });
  }

  async reactivate(actorId: string, id: string, ip: string | null): Promise<ExpenseCategory> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.expenseCategory.findUnique({ where: { id } });
      if (!current) throw new ExpenseCategoryNotFoundError(id);
      if (current.isActive) return current;

      const updated = await tx.expenseCategory.update({
        where: { id },
        data: { isActive: true },
      });

      await this.audit.log(tx, {
        action: 'expense_category_reactivated',
        actorUserId: actorId,
        entityType: 'expense_category',
        entityId: id,
        before: { isActive: false },
        after: { isActive: true },
        ip,
      });

      return updated;
    });
  }
}
