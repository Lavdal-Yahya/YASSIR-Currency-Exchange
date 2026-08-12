import { IsDateString } from 'class-validator';

// User-activity report (P6-07, spec §23.10). Period-scoped counts of
// purchases, sales, payments, expenses, reversals, and failed logins
// per user.

export class UserActivityQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}
