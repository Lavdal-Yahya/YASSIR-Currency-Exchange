import { IsDateString, IsOptional, IsUUID } from 'class-validator';

// Query for the profit report (P6-01). Period is required — a report
// without a period is meaningless; the frontend always sends month-so-far
// as the default. Currency filter narrows the breakdown to one currency.

export class ProfitQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsUUID()
  currencyId?: string;
}
