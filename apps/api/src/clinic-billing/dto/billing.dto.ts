import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const MONEY = /^\d+(\.\d{1,2})?$/;
const PREFIX = /^[A-Z0-9]{2,8}$/;
const METHODS = ['CASH', 'CARD_EXTERNAL', 'BANK_TRANSFER'] as const;

export class InviteCashierDto {
  @IsString()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email!: string;
}

export class AcceptStaffInviteDto {
  @IsString()
  @MinLength(20)
  token!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(10)
  password!: string;
}

export class MfaCodeDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class DisableMfaDto {
  @IsString()
  @MinLength(10)
  password!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(32)
  @Matches(/^(\d{6}|[0-9a-fA-F]{32})$/)
  code!: string;
}

export class MfaVerifyDto extends MfaCodeDto {
  @IsString()
  @MinLength(20)
  mfaToken!: string;
}

export class BillingSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  contact?: string;

  @IsOptional()
  @IsString()
  @Matches(PREFIX)
  invoicePrefix?: string;

  @IsOptional()
  @IsString()
  @Matches(PREFIX)
  receiptPrefix?: string;

  @IsOptional()
  @IsString()
  @Matches(PREFIX)
  creditPrefix?: string;

  @IsOptional()
  @IsUUID()
  defaultServiceId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(METHODS, { each: true })
  allowedMethods?: Array<(typeof METHODS)[number]>;

  @IsOptional()
  @IsBoolean()
  cashierMayDiscount?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  receiptFooter?: string;

  @IsOptional()
  @IsBoolean()
  taxRegistered?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  taxRegistrationNo?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,3}(\.\d{1,2})?$/)
  vatRate?: string;

  @IsOptional()
  @IsIn(['ORDINARY_RECEIPT', 'VAT_TAX_INVOICE'])
  documentMode?: 'ORDINARY_RECEIPT' | 'VAT_TAX_INVOICE';
}

export class CreateServiceDto {
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,20}$/)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsString()
  @Matches(MONEY)
  price!: string;

  @IsOptional()
  @IsIn(['UNCLASSIFIED', 'TAXABLE', 'EXEMPT'])
  taxClassification?: 'UNCLASSIFIED' | 'TAXABLE' | 'EXEMPT';
}

export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsString()
  @Matches(MONEY)
  price?: string;

  @IsOptional()
  @IsIn(['UNCLASSIFIED', 'TAXABLE', 'EXEMPT'])
  taxClassification?: 'UNCLASSIFIED' | 'TAXABLE' | 'EXEMPT';

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class InvoiceItemInput {
  @IsUUID()
  serviceId!: string;

  /** Optional line text (e.g. a prescribed medicine); defaults to the service name. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  quantity?: number;

  @IsOptional()
  @IsString()
  @Matches(MONEY)
  unitPrice?: string;

  @IsOptional()
  @IsString()
  @Matches(MONEY)
  discount?: string;
}

export class CreateInvoiceDto {
  @IsUUID()
  patientId!: string;

  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemInput)
  items!: InvoiceItemInput[];
}

export class SaveInvoiceDraftDto extends CreateInvoiceDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class VoidInvoiceDto {
  @IsString()
  @MinLength(3)
  @MaxLength(400)
  reason!: string;
}

export class RecordPaymentDto {
  @IsString()
  @Matches(MONEY)
  amount!: string;

  @IsIn(METHODS)
  method!: (typeof METHODS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  externalReference?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(80)
  idempotencyKey!: string;
}

export class RefundDto {
  @IsString()
  @Matches(MONEY)
  amount!: string;

  @IsIn(METHODS)
  method!: (typeof METHODS)[number];

  @IsString()
  @MinLength(3)
  @MaxLength(400)
  reason!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(80)
  idempotencyKey!: string;
}

export class CreditNoteDto {
  @IsString()
  @Matches(MONEY)
  amount!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(400)
  reason!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(80)
  idempotencyKey!: string;
}

export class ListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @IsOptional()
  @IsIn(METHODS)
  method?: (typeof METHODS)[number];

  @IsOptional()
  @IsUUID()
  cashierId?: string;

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
