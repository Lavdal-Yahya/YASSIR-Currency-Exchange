import { Injectable } from '@nestjs/common';
import { type Contact, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../common/prisma.service.js';
import type { CreateContactDto } from './dto/create-contact.dto.js';
import type { UpdateContactDto } from './dto/update-contact.dto.js';
import {
  ContactNotFoundError,
  ContactRoleRequiredError,
  DuplicateContactPhoneError,
} from './errors.js';

// ContactsService — customer + supplier register.
//
// Duplicate phones are a warning, not a block (spec §10.3): create/update
// throw DuplicateContactPhoneError with the existing row attached; the
// caller retries with `confirmDuplicate: true` to proceed. Enforcing DB
// uniqueness would remove the operator's option to say "yes it is a
// different person with the same number."
//
// Archive replaces delete. The DB `REVOKE DELETE` closes the back door
// so an accidental raw SQL delete cannot bypass this.

export interface ListFilters {
  includeArchived?: boolean;
  isCustomer?: boolean;
  isSupplier?: boolean;
  search?: string;
}

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(filters: ListFilters = {}): Promise<Contact[]> {
    const where: Prisma.ContactWhereInput = {};
    if (!filters.includeArchived) where.isArchived = false;
    if (filters.isCustomer !== undefined) where.isCustomer = filters.isCustomer;
    if (filters.isSupplier !== undefined) where.isSupplier = filters.isSupplier;
    if (filters.search && filters.search.trim().length > 0) {
      const q = filters.search.trim();
      where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }];
    }
    return this.prisma.contact.findMany({
      where,
      orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
    });
  }

  async getById(id: string): Promise<Contact> {
    const found = await this.prisma.contact.findUnique({ where: { id } });
    if (!found) throw new ContactNotFoundError(id);
    return found;
  }

  async create(actorId: string, dto: CreateContactDto, ip: string | null): Promise<Contact> {
    // At least one flag must be true. Default (nothing sent) is customer=true.
    const isCustomer = dto.isCustomer ?? true;
    const isSupplier = dto.isSupplier ?? false;
    if (!isCustomer && !isSupplier) throw new ContactRoleRequiredError();

    return this.prisma.$transaction(async (tx) => {
      if (dto.phone && !dto.confirmDuplicate) {
        const existing = await tx.contact.findFirst({
          where: { phone: dto.phone, isArchived: false },
          orderBy: { createdAt: 'asc' },
        });
        if (existing) {
          throw new DuplicateContactPhoneError(dto.phone, {
            id: existing.id,
            name: existing.name,
          });
        }
      }

      const created = await tx.contact.create({
        data: {
          name: dto.name.trim(),
          phone: dto.phone ?? null,
          isCustomer,
          isSupplier,
          notes: dto.notes ?? null,
        },
      });

      await this.audit.log(tx, {
        action: 'contact_created',
        actorUserId: actorId,
        entityType: 'contact',
        entityId: created.id,
        after: serializeContact(created),
        ip,
      });

      return created;
    });
  }

  async update(
    actorId: string,
    id: string,
    dto: UpdateContactDto,
    ip: string | null,
  ): Promise<Contact> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.contact.findUnique({ where: { id } });
      if (!before) throw new ContactNotFoundError(id);

      const nextIsCustomer = dto.isCustomer ?? before.isCustomer;
      const nextIsSupplier = dto.isSupplier ?? before.isSupplier;
      if (!nextIsCustomer && !nextIsSupplier) throw new ContactRoleRequiredError();

      const nextPhone = dto.phone === undefined ? before.phone : dto.phone || null;
      if (nextPhone && nextPhone !== before.phone && !dto.confirmDuplicate) {
        const existing = await tx.contact.findFirst({
          where: { phone: nextPhone, isArchived: false, NOT: { id } },
          orderBy: { createdAt: 'asc' },
        });
        if (existing) {
          throw new DuplicateContactPhoneError(nextPhone, {
            id: existing.id,
            name: existing.name,
          });
        }
      }

      const updated = await tx.contact.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone || null } : {}),
          ...(dto.isCustomer !== undefined ? { isCustomer: dto.isCustomer } : {}),
          ...(dto.isSupplier !== undefined ? { isSupplier: dto.isSupplier } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}),
        },
      });

      const diff = diffChanged(serializeContact(before), serializeContact(updated));
      if (Object.keys(diff.after).length > 0) {
        await this.audit.log(tx, {
          action: 'contact_updated',
          actorUserId: actorId,
          entityType: 'contact',
          entityId: id,
          before: diff.before,
          after: diff.after,
          ip,
        });
      }

      return updated;
    });
  }

  async archive(actorId: string, id: string, ip: string | null): Promise<Contact> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.contact.findUnique({ where: { id } });
      if (!current) throw new ContactNotFoundError(id);
      if (current.isArchived) return current;

      const updated = await tx.contact.update({
        where: { id },
        data: { isArchived: true },
      });

      await this.audit.log(tx, {
        action: 'contact_archived',
        actorUserId: actorId,
        entityType: 'contact',
        entityId: id,
        before: { isArchived: false },
        after: { isArchived: true },
        ip,
      });

      return updated;
    });
  }

  async unarchive(actorId: string, id: string, ip: string | null): Promise<Contact> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.contact.findUnique({ where: { id } });
      if (!current) throw new ContactNotFoundError(id);
      if (!current.isArchived) return current;

      const updated = await tx.contact.update({
        where: { id },
        data: { isArchived: false },
      });

      await this.audit.log(tx, {
        action: 'contact_unarchived',
        actorUserId: actorId,
        entityType: 'contact',
        entityId: id,
        before: { isArchived: true },
        after: { isArchived: false },
        ip,
      });

      return updated;
    });
  }
}

function serializeContact(c: Contact): Prisma.JsonObject {
  return {
    name: c.name,
    phone: c.phone,
    isCustomer: c.isCustomer,
    isSupplier: c.isSupplier,
    isArchived: c.isArchived,
    notes: c.notes,
  };
}

function diffChanged(
  before: Prisma.JsonObject,
  after: Prisma.JsonObject,
): { before: Prisma.JsonObject; after: Prisma.JsonObject } {
  const b: Prisma.JsonObject = {};
  const a: Prisma.JsonObject = {};
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) {
      b[key] = before[key] ?? null;
      a[key] = after[key] ?? null;
    }
  }
  return { before: b, after: a };
}
