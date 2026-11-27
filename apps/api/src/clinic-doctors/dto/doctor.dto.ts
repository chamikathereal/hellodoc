import {
  IsBoolean,
  IsEmail,
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
import { IsSriLankanMobile } from '../../common/sri-lanka-mobile.js';

export class CreateDoctorDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @IsUUID()
  specializationId!: string;

  @IsUUID()
  qualificationId!: string;

  @IsOptional()
  @IsString()
  @IsSriLankanMobile()
  contactNumber?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsBoolean()
  confirmDuplicate?: boolean;
}

export class UpdateDoctorDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @IsUUID()
  specializationId!: string;

  @IsUUID()
  qualificationId!: string;

  @IsOptional()
  @IsString()
  @IsSriLankanMobile()
  contactNumber?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  version!: number;
}

export class DeactivateDoctorDto {
  /** Cancel the doctor's future sessions that have no bookings, then deactivate. */
  @IsOptional()
  @IsBoolean()
  cancelFutureSessions?: boolean;
}

export class ListDoctorsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(ACTIVE|INACTIVE|ALL)$/)
  status?: 'ACTIVE' | 'INACTIVE' | 'ALL';

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
