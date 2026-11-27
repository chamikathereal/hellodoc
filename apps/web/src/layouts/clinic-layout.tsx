import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { AppSidebar } from '@/components/app-sidebar';
import { ModeToggle } from '@/components/mode-toggle';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { api } from '@/lib/api';
import { useClinicAuth } from '@/lib/auth';

function crumbParts(title?: string) {
  if (
    title === 'Sessions' ||
    title === 'Doctors' ||
    title === 'Patients' ||
    title === 'Appointments'
  ) {
    return { root: 'Clinic', page: title };
  }
  return { root: 'HelloDoc', page: title ?? 'Clinic' };
}

export function ClinicLayout({ title }: { title?: string }) {
  const { user, loading } = useClinicAuth();
  const [clinicName, setClinicName] = useState<string | null>(null);
  const crumbs = crumbParts(title);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api<{ clinicName: string }>('/clinic/me', { toast: false })
      .then((me) => {
        if (!cancelled) setClinicName(me.clinicName);
      })
      .catch(() => {
        if (!cancelled) setClinicName(user.clinicName);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Verifying session…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  return (
    <SidebarProvider>
      <AppSidebar clinicName={clinicName} />
      {/* min-w-0: wide tables scroll inside their own container instead of widening the page on tablets. */}
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <span className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                  {crumbs.root}
                </span>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage className="text-xs font-semibold tracking-[0.14em] text-foreground uppercase">
                  {crumbs.page}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-1">
            <ModeToggle />
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-6 bg-muted/50 p-4 md:p-6 animate-rise">
          <Outlet context={{ clinicName }} />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
