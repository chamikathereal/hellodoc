import { Module } from '@nestjs/common';
import { TenantProvisioningModule } from '../tenant-provisioning/tenant-provisioning.module.js';
import { ClinicalController } from './clinical.controller.js';
import { ClinicalService } from './clinical.service.js';

@Module({
  imports: [TenantProvisioningModule],
  controllers: [ClinicalController],
  providers: [ClinicalService],
})
export class ClinicClinicalModule {}
