import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

export interface LedgerListArgs {
  currencyId?: string;
  from?: Date;
  to?: Date;
  includeInactive?: boolean;
  limit: number;
  offset: number;
}

export interface LedgerRow {
  id: string; // BigInt serialised for JSON
  currencyId: string;
  direction: 'CREDIT' | 'DEBIT';
  amount: string;
  sourceType: string;
  sourceId: string | null;
  paymentMethodId: string | null;
  note: string | null;
  transactionDate: Date;
  sequence: string; // BigInt serialised
  description: string;
  isActive: boolean;
  createdByUserId: string;
  createdAt: Date;
}

// Read façade over currency_ledger. Enforces server-side pagination
// (spec §41), and hides is_active=false rows from the default view —
// they surface only when the caller explicitly asks for them, which
// the P6-06 audit viewer will do.

@Injectable()
export class LedgerReadService {
  constructor(private readonly prisma: PrismaService) {}

  async list(args: LedgerListArgs): Promise<{ rows: LedgerRow[]; total: number }> {
    const where: Prisma.CurrencyLedgerWhereInput = {};
    if (args.currencyId) where.currencyId = args.currencyId;
    if (!args.includeInactive) where.isActive = true;
    if (args.from || args.to) {
      where.transactionDate = {};
      if (args.from) where.transactionDate.gte = args.from;
      if (args.to) where.transactionDate.lte = args.to;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.currencyLedger.findMany({
        where,
        orderBy: [{ transactionDate: 'desc' }, { sequence: 'desc' }],
        take: args.limit,
        skip: args.offset,
      }),
      this.prisma.currencyLedger.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id.toString(),
        currencyId: r.currencyId,
        direction: r.direction,
        amount: r.amount.toString(),
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        paymentMethodId: r.paymentMethodId,
        note: r.note,
        transactionDate: r.transactionDate,
        sequence: r.sequence.toString(),
        description: r.description,
        isActive: r.isActive,
        createdByUserId: r.createdByUserId,
        createdAt: r.createdAt,
      })),
      total,
    };
  }
}
