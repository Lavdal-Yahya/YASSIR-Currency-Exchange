import { Injectable, NotFoundException } from '@nestjs/common';
import type { Purchase, Sale } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
import { mapSaleResponse, type SalePublicRow, type SaleResponse } from './trade-common.js';
import type { ListTradesQueryDto } from './dto/list-trades.dto.js';

export interface Paginated<T> {
  data: T[];
  total: number;
}

// Shape returned by GET /contacts/:id/trades — purchases and sales in a
// unified timeline so the frontend can render one list sorted by date.
export type ContactTradeItem =
  ({ kind: 'purchase' } & Purchase) | ({ kind: 'sale' } & SaleResponse);

@Injectable()
export class TradeReadService {
  constructor(private readonly prisma: PrismaService) {}

  async listPurchases(filters: ListTradesQueryDto): Promise<Paginated<Purchase>> {
    const where = buildPurchaseWhere(filters);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.purchase.findMany({
        where,
        orderBy: { transactionDate: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.purchase.count({ where }),
    ]);

    return { data, total };
  }

  async getPurchase(id: string): Promise<Purchase> {
    const row = await this.prisma.purchase.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Purchase ${id} not found`);
    return row;
  }

  async listSales(
    filters: ListTradesQueryDto,
    hasProfitView: boolean,
  ): Promise<Paginated<SaleResponse>> {
    const where = buildSaleWhere(filters);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.sale.findMany({
        where,
        orderBy: { transactionDate: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.sale.count({ where }),
    ]);

    return {
      data: rows.map((s) => mapSaleResponse(s, hasProfitView)),
      total,
    };
  }

  async getSale(id: string, hasProfitView: boolean): Promise<SaleResponse> {
    const row = await this.prisma.sale.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Sale ${id} not found`);
    return mapSaleResponse(row, hasProfitView);
  }

  async listContactTrades(
    contactId: string,
    hasProfitView: boolean,
    limit = 50,
    offset = 0,
  ): Promise<Paginated<ContactTradeItem>> {
    // Fetch both sides without pagination first so we can merge-sort them.
    // A contact's per-currency history is bounded in practice; we cap at
    // 500 rows per side to keep the in-memory sort fast.
    const CAP = 500;

    const [purchases, sales] = await Promise.all([
      this.prisma.purchase.findMany({
        where: { contactId },
        orderBy: { transactionDate: 'desc' },
        take: CAP,
      }),
      this.prisma.sale.findMany({
        where: { contactId },
        orderBy: { transactionDate: 'desc' },
        take: CAP,
      }),
    ]);

    const combined: ContactTradeItem[] = [
      ...purchases.map((p): ContactTradeItem => ({ kind: 'purchase', ...p })),
      ...sales.map(
        (s): ContactTradeItem =>
          ({ kind: 'sale', ...mapSaleResponse(s, hasProfitView) }) as ContactTradeItem,
      ),
    ].sort((a, b) => b.transactionDate.getTime() - a.transactionDate.getTime());

    const total = combined.length;
    const data = combined.slice(offset, offset + limit);

    return { data, total };
  }
}

// ---------------------------------------------------------------------------
// Where-clause builders
// ---------------------------------------------------------------------------

function buildPurchaseWhere(f: ListTradesQueryDto) {
  return {
    ...(f.contactId ? { contactId: f.contactId } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.paymentStatus ? { paymentStatus: f.paymentStatus } : {}),
    ...(f.currencyId
      ? {
          OR: [{ deliveredCurrencyId: f.currencyId }, { paymentCurrencyId: f.currencyId }],
        }
      : {}),
    ...(f.dateFrom || f.dateTo
      ? {
          transactionDate: {
            ...(f.dateFrom ? { gte: new Date(f.dateFrom) } : {}),
            ...(f.dateTo ? { lte: new Date(f.dateTo) } : {}),
          },
        }
      : {}),
  };
}

function buildSaleWhere(f: ListTradesQueryDto) {
  return {
    ...(f.contactId ? { contactId: f.contactId } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.paymentStatus ? { paymentStatus: f.paymentStatus } : {}),
    ...(f.currencyId
      ? {
          OR: [{ deliveredCurrencyId: f.currencyId }, { paymentCurrencyId: f.currencyId }],
        }
      : {}),
    ...(f.dateFrom || f.dateTo
      ? {
          transactionDate: {
            ...(f.dateFrom ? { gte: new Date(f.dateFrom) } : {}),
            ...(f.dateTo ? { lte: new Date(f.dateTo) } : {}),
          },
        }
      : {}),
  };
}
