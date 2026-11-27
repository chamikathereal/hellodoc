export type ActiveMembership = { tenantId: string; role: string };

export const EMAIL_ALREADY_REGISTERED_MESSAGE =
  'This email address is already registered to an existing account. Use a different email address.';

/**
 * A clinic sign-in supports exactly one active clinic membership per account: a second one makes
 * the user unable to log in ("Multiple clinic memberships require explicit clinic selection").
 * Returns true when the account already holds an active membership other than `allow`
 * (the membership the current invite would create or re-activate).
 */
export function hasConflictingClinicMembership(
  activeMemberships: readonly ActiveMembership[],
  allow?: ActiveMembership,
): boolean {
  return activeMemberships.some(
    (m) => !(allow && m.tenantId === allow.tenantId && m.role === allow.role),
  );
}
