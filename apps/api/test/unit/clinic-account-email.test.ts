import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasConflictingClinicMembership } from '../../src/common/clinic-account-email.js';

const CLINIC_A = '216561ed-a94f-483f-be5e-e911365cbdbe';
const CLINIC_B = 'd89f3f1c-5ec7-4c17-ad8b-6b944c3b7b7c';

describe('clinic account email availability', () => {
  it('allows an email with no account or no active memberships', () => {
    assert.equal(hasConflictingClinicMembership([]), false);
    assert.equal(hasConflictingClinicMembership([], { tenantId: CLINIC_A, role: 'CLINIC_DOCTOR' }), false);
  });

  it('rejects a staff invite for the clinic manager email (cashier lockout case)', () => {
    assert.equal(hasConflictingClinicMembership([{ tenantId: CLINIC_A, role: 'CLINIC_MANAGER' }]), true);
    assert.equal(
      hasConflictingClinicMembership([{ tenantId: CLINIC_A, role: 'CLINIC_MANAGER' }], {
        tenantId: CLINIC_A,
        role: 'CLINIC_CASHIER',
      }),
      true,
    );
  });

  it('rejects a doctor login for a doctor already active in another clinic', () => {
    assert.equal(
      hasConflictingClinicMembership([{ tenantId: CLINIC_A, role: 'CLINIC_DOCTOR' }], {
        tenantId: CLINIC_B,
        role: 'CLINIC_DOCTOR',
      }),
      true,
    );
  });

  it('allows re-inviting the same role in the same clinic', () => {
    assert.equal(
      hasConflictingClinicMembership([{ tenantId: CLINIC_A, role: 'CLINIC_DOCTOR' }], {
        tenantId: CLINIC_A,
        role: 'CLINIC_DOCTOR',
      }),
      false,
    );
  });
});
