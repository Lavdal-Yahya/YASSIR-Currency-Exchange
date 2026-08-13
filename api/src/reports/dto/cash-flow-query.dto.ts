import { IsDateString } from 'class-validator';

export class CashFlowQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}
