export type Doctor = {
  id: string;
  fullName: string;
  displayName: string;
  registrationNumber: string;
  specializationId: string | null;
  qualificationId: string | null;
  qualifications: string | null;
  specialization: string | null;
  contactNumber: string | null;
  email: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  credentialReviewStatus?: 'PENDING_REVIEW' | 'VERIFIED' | 'SUSPENDED';
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ConsultationSession = {
  id: string;
  doctorId: string;
  doctorDisplayName: string | null;
  localDate: string;
  startAt: string;
  endAt: string;
  timezone: string;
  capacity: number;
  expectedDurationMinutes: number;
  status: string;
  location: string | null;
  internalNotes: string | null;
  version: number;
  cancellationReason: string | null;
  /** Actual time the session was first opened (session detail only). */
  openedAt?: string | null;
  /** Actual time the session was closed, manually or automatically (session detail only). */
  closedAt?: string | null;
};

export type PatientContact = {
  id: string;
  contactType: 'MOBILE' | 'LANDLINE' | 'GUARDIAN_MOBILE' | 'OTHER' | string;
  displayValue: string;
  normalizedValue: string;
  contactPersonName: string | null;
  relationship: string | null;
  isPrimary: boolean;
};

export type Patient = {
  id: string;
  patientNumber: string;
  fullName: string;
  preferredName: string | null;
  dateOfBirth: string | null;
  approximateAgeYears: number | null;
  ageRecordedOn: string | null;
  sex: 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN' | null;
  address: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  contactExceptionReason: string | null;
  primaryContact: {
    displayValue: string;
    contactType: string;
    masked: string;
  } | null;
  contacts: PatientContact[];
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string | null;
  deactivatedAt: string | null;
  deactivatedBy: string | null;
  deactivationReason: string | null;
};

export type PatientDuplicateMatch = {
  id: string;
  patientNumber: string;
  fullName: string;
  dateOfBirth: string | null;
  approximateAgeYears: number | null;
  primaryContactMasked: string | null;
  status: string;
  sharedPhone: boolean;
  nameMatch: boolean;
  dobMatch: boolean;
  ageHintMatch: boolean;
  strength: 'STRONG' | 'SHARED_PHONE' | 'WEAK';
  reasons: string[];
};

export type Appointment = {
  id: string;
  bookingReference: string;
  patientId: string;
  patientNumber: string | null;
  patientFullName: string | null;
  sessionId: string;
  doctorId: string | null;
  doctorDisplayName: string | null;
  localDate: string | null;
  startAt: string | null;
  endAt: string | null;
  timezone: string | null;
  sessionStatus: string | null;
  /** Live queue state (RESERVED until check-in, then WAITING, CALLED, ...). */
  queueState?: string | null;
  checkedInAt?: string | null;
  /** Actual queue timings recorded for this appointment. */
  calledAt?: string | null;
  consultationStartedAt?: string | null;
  consultationEndedAt?: string | null;
  queueNumber: number;
  queueDisplay: string;
  bookingSource: 'PHONE' | 'WALK_IN' | string;
  status: 'CONFIRMED' | 'CANCELLED' | 'RESCHEDULED' | string;
  internalNotes: string | null;
  cancellationReason: string | null;
  cancelledAt: string | null;
  rescheduledFromId: string | null;
  rescheduleReason: string | null;
  /** Only on a RESCHEDULED appointment: the latest booking that replaced it. */
  rescheduledToId?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Status shown to staff: a confirmed appointment reads "CHECKED IN" once the patient has checked in,
 * and a cancelled appointment reads "CANCELLED SESSION" when its consultation session was cancelled.
 */
export function appointmentDisplayStatus(
  a: Pick<Appointment, 'status' | 'checkedInAt'> & { sessionStatus?: string | null },
): string {
  if (a.status === 'CONFIRMED' && a.checkedInAt) return 'CHECKED IN';
  if (a.status === 'CANCELLED' && a.sessionStatus === 'CANCELLED') return 'CANCELLED SESSION';
  return a.status;
}

export type SessionAvailability = {
  sessionId: string;
  doctorId: string;
  doctorDisplayName: string | null;
  localDate: string | null;
  startAt: string;
  endAt: string;
  timezone: string;
  capacity: number;
  bookedCount: number;
  remaining: number;
  nextQueueNumber: number;
  status: string;
  bookable: boolean;
};

export type ScheduleTemplate = {
  id: string;
  doctorId: string;
  weekday: number;
  localStartTime: string;
  localEndTime: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  defaultCapacity: number;
  expectedDurationMinutes: number;
  timezone: string;
  isActive: boolean;
};

export const WEEKDAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
] as const;
