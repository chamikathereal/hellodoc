import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSessionDto {
  @IsUUID()
  doctorId!: string;

  @IsDateString()
  localDate!: string;

  @Matches(/^\d{2}:\d{2}$/)
  startTime!: string;

  @Matches(/^\d{2}:\d{2}$/)
  endTime!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Maximum patients must be a whole number' })
  @Min(1, { message: 'Maximum patients must be at least 1' })
  @Max(500, { message: 'Maximum patients cannot be more than 500' })
  capacity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Expected consult must be a whole number of minutes' })
  @Min(1, { message: 'Expected consult must be at least 1 minute' })
  @Max(240, { message: 'Expected consult cannot be more than 240 minutes' })
  expectedDurationMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  internalNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

export class UpdateSessionDto {
  @IsDateString()
  localDate!: string;

  @Matches(/^\d{2}:\d{2}$/)
  startTime!: string;

  @Matches(/^\d{2}:\d{2}$/)
  endTime!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  capacity!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(240)
  expectedDurationMinutes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  internalNotes?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class CancelSessionDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class ListSessionsQueryDto {
  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  /** ALL, one status, or a comma-separated list (e.g. OPEN,PAUSED). */
  @IsOptional()
  @Matches(/^(ALL|(SCHEDULED|OPEN|PAUSED|DELAYED|CLOSED|CANCELLED)(,(SCHEDULED|OPEN|PAUSED|DELAYED|CLOSED|CANCELLED))*)$/, {
    message: 'Invalid session status filter',
  })
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
