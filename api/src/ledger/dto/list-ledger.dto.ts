import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

// Filter set for GET /ledger. Every filter is optional; when nothing is
// supplied the endpoint returns the most recent page of every
// currency's active entries.
//
// `from` / `to` are ISO date-time strings; the server converts them via
// `new Date()`. The frontend converts them from business-timezone dates
// on submit — the ledger stores UTC and reports apply the tz.
export class ListLedgerQueryDto {
  @IsOptional()
  @IsUUID()
  currencyId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  // includeInactive flag — reserved for the audit viewer in P6-06; in
  // P3 it is silently ignored unless the caller has ledger:read (they
  // already do to hit the route). Left here as a signal of intent.
  @IsOptional()
  includeInactive?: 'true' | 'false';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
