import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ClinicLayout } from '@/layouts/clinic-layout';
import { PlatformLayout } from '@/layouts/platform-layout';
import { ClinicAuthProvider, PlatformAuthProvider } from '@/lib/auth';
import { DashboardPage } from '@/pages/dashboard-page';
import { DoctorDetailPage } from '@/pages/doctor-detail-page';
import { DoctorFormPage } from '@/pages/doctor-form-page';
import { DoctorsPage } from '@/pages/doctors-page';
import { HomePage } from '@/pages/home-page';
import { LoginPage } from '@/pages/login-page';
import { PlatformAdminPage } from '@/pages/platform-admin-page';
import { PlatformClinicDetailPage } from '@/pages/platform-clinic-detail-page';
import { PlatformSmsGatewayPage } from '@/pages/platform-sms-gateway-page';
import {
  PlatformQualificationsPage,
  PlatformRelationshipsPage,
  PlatformSpecializationsPage,
} from '@/pages/platform-catalog-page';
import { RegisterPage } from '@/pages/register-page';
import { BillingReportsPage } from '@/pages/billing-reports-page';
import { BillingSettingsPage } from '@/pages/billing-settings-page';
import { CashierAcceptPage } from '@/pages/cashier-accept-page';
import { InvoiceDetailPage } from '@/pages/invoice-detail-page';
import { InvoiceFormPage } from '@/pages/invoice-form-page';
import { InvoicesPage } from '@/pages/invoices-page';
import { PaymentsPage } from '@/pages/payments-page';
import { ServicesPage } from '@/pages/services-page';
import { AppointmentDetailPage } from '@/pages/appointment-detail-page';
import { AppointmentFormPage } from '@/pages/appointment-form-page';
import { AppointmentsPage } from '@/pages/appointments-page';
import { PatientDetailPage } from '@/pages/patient-detail-page';
import { PatientFormPage } from '@/pages/patient-form-page';
import { PatientsPage } from '@/pages/patients-page';
import { DoctorAcceptPage } from '@/pages/doctor-accept-page';
import { DoctorCalendarPage } from '@/pages/doctor-calendar-page';
import { DoctorWorklistPage } from '@/pages/doctor-worklist-page';
import { ConsultationPage } from '@/pages/consultation-page';
import { NotificationSettingsPage } from '@/pages/notification-settings-page';
import { NotificationsPage } from '@/pages/notifications-page';
import { PublicTrackPage } from '@/pages/public-track-page';
import { SessionDetailPage } from '@/pages/session-detail-page';
import { SessionFormPage } from '@/pages/session-form-page';
import { SessionQueuePage } from '@/pages/session-queue-page';
import { SessionsPage } from '@/pages/sessions-page';

const queryClient = new QueryClient();

function RedirectClinicSms() {
  const { tenantId } = useParams();
  return <Navigate to={`/platform-admin/clinics/${tenantId ?? ''}`} replace />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <ClinicAuthProvider>
            <PlatformAuthProvider>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/track/:token" element={<PublicTrackPage />} />
                <Route path="/doctor/accept" element={<DoctorAcceptPage />} />
                <Route path="/cashier/accept" element={<CashierAcceptPage />} />
                <Route path="/receptionist/accept" element={<CashierAcceptPage />} />
                <Route element={<PlatformLayout />}>
                  <Route path="/platform-admin" element={<PlatformAdminPage />} />
                  <Route path="/platform-admin/sms-gateway" element={<PlatformSmsGatewayPage />} />
                  <Route
                    path="/platform-admin/clinics/:tenantId/sms"
                    element={<RedirectClinicSms />}
                  />
                  <Route
                    path="/platform-admin/clinics/:tenantId"
                    element={<PlatformClinicDetailPage />}
                  />
                  <Route
                    path="/platform-admin/specializations"
                    element={<PlatformSpecializationsPage />}
                  />
                  <Route
                    path="/platform-admin/qualifications"
                    element={<PlatformQualificationsPage />}
                  />
                  <Route
                    path="/platform-admin/relationships"
                    element={<PlatformRelationshipsPage />}
                  />
                </Route>

                <Route element={<ClinicLayout title="Clinic dashboard" />}>
                  <Route path="/dashboard" element={<DashboardPage />} />
                </Route>
                <Route element={<ClinicLayout title="Doctors" />}>
                  <Route path="/doctors" element={<DoctorsPage />} />
                  <Route path="/doctors/new" element={<DoctorFormPage />} />
                  <Route path="/doctors/:id" element={<DoctorDetailPage />} />
                  <Route path="/doctors/:id/edit" element={<DoctorFormPage />} />
                </Route>
                <Route element={<ClinicLayout title="Sessions" />}>
                  <Route path="/sessions" element={<SessionsPage />} />
                  <Route path="/sessions/new" element={<SessionFormPage />} />
                  <Route path="/sessions/:id" element={<SessionDetailPage />} />
                  <Route path="/sessions/:id/queue" element={<SessionQueuePage />} />
                </Route>
                <Route element={<ClinicLayout title="Patients" />}>
                  <Route path="/patients" element={<PatientsPage />} />
                  <Route path="/patients/new" element={<PatientFormPage />} />
                  <Route path="/patients/:id" element={<PatientDetailPage />} />
                  <Route path="/patients/:id/edit" element={<PatientFormPage />} />
                </Route>
                <Route element={<ClinicLayout title="Appointments" />}>
                  <Route path="/appointments" element={<AppointmentsPage />} />
                  <Route path="/appointments/new" element={<AppointmentFormPage />} />
                  <Route path="/appointments/:id" element={<AppointmentDetailPage />} />
                </Route>
                <Route element={<ClinicLayout title="Doctor" />}>
                  <Route path="/doctor/worklist" element={<DoctorWorklistPage />} />
                  <Route path="/doctor/calendar" element={<DoctorCalendarPage />} />
                  <Route path="/consultations/:id" element={<ConsultationPage />} />
                </Route>
                <Route element={<ClinicLayout title="Billing" />}>
                  <Route path="/billing/invoices" element={<InvoicesPage />} />
                  <Route path="/billing/invoices/new" element={<InvoiceFormPage />} />
                  <Route path="/billing/invoices/:id" element={<InvoiceDetailPage />} />
                  <Route path="/billing/services" element={<ServicesPage />} />
                  <Route path="/billing/payments" element={<PaymentsPage />} />
                  <Route path="/billing/reports" element={<BillingReportsPage />} />
                  <Route path="/settings/billing" element={<BillingSettingsPage />} />
                  <Route path="/settings/security" element={<Navigate to="/dashboard" replace />} />
                </Route>
                <Route element={<ClinicLayout title="Notifications" />}>
                  <Route path="/notifications" element={<NotificationsPage />} />
                  <Route path="/settings/notifications" element={<NotificationSettingsPage />} />
                </Route>

                <Route path="/settings" element={<Navigate to="/settings/notifications" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </PlatformAuthProvider>
          </ClinicAuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
