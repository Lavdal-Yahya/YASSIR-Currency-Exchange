import { Injectable } from '@nestjs/common';
import type { Payable, Receivable } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../common/prisma.service.js';
import { ContactNotFoundError } from '../contacts/errors.js';
import { CurrencyNotFoundError } from '../currencies/errors.js';
import type { CreateOpeningDebtDto } from './dto/create-opening-debt.dto.js';
import { OpeningBalanceService } from './opening-balance.service.js';

// OpeningDebtService — P3-09, D-010.
//
// Opening debts land as receivable/payable rows with origin=OPENING
// and null (source_type, source_id). They do NOT write to the ledger:
// a debt is not a currency movement. The CHECK constraint on the
// receivable/payable tables enforces the origin/source shape.
//
// Symmetric receivable vs payable; the DTO carries `side` so the
// service can pick the right table.

export interface OpeningDebtRecord {
  side: 'receivable' | 'payable';
  row: Receivable | Payable;
}

@Injectable()
export class OpeningDebtService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly openings: OpeningBalanceService,
  ) {}

  async list(): Promise<{ receivables: Receivable[]; payables: Payable[] }> {
    const [receivables, payables] = await this.prisma.$transaction([
      this.prisma.receivable.findMany({
        where: { origin: 'OPENING' },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.payable.findMany({
        where: { origin: 'OPENING' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { receivables, payables };
  }

  async create(
    actorId: string,
    dto: CreateOpeningDebtDto,
    ip: string | null,
  ): Promise<OpeningDebtRecord> {
    await this.openings.assertPreGoLive();

    return this.prisma.$transaction(async (tx) => {
      const [contact, currency] = await Promise.all([
        tx.contact.findUnique({ where: { id: dto.contactId } }),
        tx.currency.findUnique({ where: { id: dto.currencyId } }),
      ]);
      if (!contact) throw new ContactNotFoundError(dto.contactId);
      if (!currency) throw new CurrencyNotFoundError(dto.currencyId);

      const shared = {
        contactId: dto.contactId,
        currencyId: dto.currencyId,
        originalAmount: dto.amount,
        outstandingAmount: dto.amount,
        origin: 'OPENING' as const,
        // source_type / source_id remain null — enforced by
        // receivable_origin_source_shape_check.
      };
      const row =
        dto.side === 'receivable'
          ? await tx.receivable.create({ data: shared })
          : await tx.payable.create({ data: shared });

      await this.audit.log(tx, {
        action:
          dto.side === 'receivable' ? 'opening_receivable_created' : 'opening_payable_created',
        actorUserId: actorId,
        entityType: dto.side,
        entityId: row.id,
        after: {
          contactId: contact.id,
          contactName: contact.name,
          currencyCode: currency.code,
          amount: row.originalAmount.toString(),
        },
        ip,
      });

      return { side: dto.side, row };
    });
  }
}
