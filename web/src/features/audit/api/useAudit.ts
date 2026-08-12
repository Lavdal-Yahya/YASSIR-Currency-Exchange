import { useQuery } from '@tanstack/react-query';
import { request } from '../../../shared/api/client';

// Audit viewer (P6-06). Owner-only via AUDIT_READ permission.

export interface AuditLogRow {
  id: string;
  actorUserId: string | null;
  actorPhone: string | null;
  actorName: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
  createdAt: string;
}

export interface AuditFilters {
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export interface Paginated<T> {
  data: T[];
  total: number;
}

function qs(f: AuditFilters): string {
  const parts: string[] = [];
  if (f.entityType) parts.push(`entityType=${encodeURIComponent(f.entityType)}`);
  if (f.entityId) parts.push(`entityId=${encodeURIComponent(f.entityId)}`);
  if (f.actorUserId) parts.push(`actorUserId=${encodeURIComponent(f.actorUserId)}`);
  if (f.action) parts.push(`action=${encodeURIComponent(f.action)}`);
  if (f.dateFrom) parts.push(`dateFrom=${encodeURIComponent(f.dateFrom)}`);
  if (f.dateTo) parts.push(`dateTo=${encodeURIComponent(f.dateTo)}`);
  if (f.limit !== undefined) parts.push(`limit=${f.limit}`);
  if (f.offset !== undefined) parts.push(`offset=${f.offset}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export function useAuditLog(filters: AuditFilters = {}) {
  return useQuery<Paginated<AuditLogRow>>({
    queryKey: ['audit', filters],
    queryFn: () => request<Paginated<AuditLogRow>>(`/audit-log${qs(filters)}`),
  });
}
