import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Contact } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { PERMISSIONS } from '../common/permissions.js';
import { ContactsService } from './contacts.service.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { UpdateContactDto } from './dto/update-contact.dto.js';

// No DELETE. `POST /:id/archive` and `POST /:id/unarchive` are the only
// ways to hide a contact from the list. Historical trades and debts must
// stay readable — see phase-2.md §3.

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @RequirePermission(PERMISSIONS.CONTACT_READ)
  @Get()
  async list(
    @Query('includeArchived', new ParseBoolPipe({ optional: true })) includeArchived?: boolean,
    @Query('isCustomer', new ParseBoolPipe({ optional: true })) isCustomer?: boolean,
    @Query('isSupplier', new ParseBoolPipe({ optional: true })) isSupplier?: boolean,
    @Query('search') search?: string,
  ): Promise<Contact[]> {
    return this.contacts.list({
      includeArchived: includeArchived ?? false,
      isCustomer,
      isSupplier,
      search,
    });
  }

  @RequirePermission(PERMISSIONS.CONTACT_READ)
  @Get(':id')
  async getOne(@Param('id', new ParseUUIDPipe()) id: string): Promise<Contact> {
    return this.contacts.getById(id);
  }

  @RequirePermission(PERMISSIONS.CONTACT_MANAGE)
  @Post()
  async create(
    @Body() dto: CreateContactDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<Contact> {
    return this.contacts.create(actor.id, dto, req.ip ?? null);
  }

  @RequirePermission(PERMISSIONS.CONTACT_MANAGE)
  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateContactDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<Contact> {
    return this.contacts.update(actor.id, id, dto, req.ip ?? null);
  }

  @RequirePermission(PERMISSIONS.CONTACT_MANAGE)
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<Contact> {
    return this.contacts.archive(actor.id, id, req.ip ?? null);
  }

  @RequirePermission(PERMISSIONS.CONTACT_MANAGE)
  @Post(':id/unarchive')
  @HttpCode(HttpStatus.OK)
  async unarchive(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ): Promise<Contact> {
    return this.contacts.unarchive(actor.id, id, req.ip ?? null);
  }
}
