import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  ChevronsUpDown,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Receipt,
  Settings,
  Settings2,
  Stethoscope,
  Tag,
  Users,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar';
import { useClinicAuth } from '@/lib/auth';

const managerNav = [
  { title: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, enabled: true },
  { title: 'Doctors', to: '/doctors', icon: Stethoscope, enabled: true },
  { title: 'Sessions', to: '/sessions', icon: CalendarClock, enabled: true },
  { title: 'Patients', to: '/patients', icon: Users, enabled: true },
  { title: 'Appointments', to: '/appointments', icon: CalendarCheck2, enabled: true },
  { title: 'SMS History', to: '/notifications', icon: Bell, enabled: true },
  { title: 'Invoices', to: '/billing/invoices', icon: Receipt, enabled: true },
  { title: 'Services', to: '/billing/services', icon: Tag, enabled: true },
  { title: 'Billing reports', to: '/billing/reports', icon: Receipt, enabled: true },
] as const;

const doctorNav = [
  { title: 'Worklist', to: '/doctor/worklist', icon: Stethoscope, enabled: true },
  { title: 'Calendar', to: '/doctor/calendar', icon: CalendarDays, enabled: true },
] as const;

const receptionistNav = [
  { title: 'Patients', to: '/patients', icon: Users, enabled: true },
  { title: 'Appointments', to: '/appointments', icon: CalendarCheck2, enabled: true },
  { title: 'Sessions', to: '/sessions', icon: CalendarClock, enabled: true },
] as const;

const cashierNav = [
  { title: 'Invoices', to: '/billing/invoices', icon: Receipt, enabled: true },
  { title: 'Services', to: '/billing/services', icon: Tag, enabled: true },
  { title: 'Payments', to: '/billing/payments', icon: Receipt, enabled: true },
  { title: 'Billing reports', to: '/billing/reports', icon: Receipt, enabled: true },
] as const;

const managerSettingsNav = [
  { title: 'SMS Settings', to: '/settings/notifications', icon: Settings2 },
  { title: 'Billing settings', to: '/settings/billing', icon: Settings2 },
] as const;

const staffSettingsNav: readonly { title: string; to: string; icon: typeof Settings2 }[] = [];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function AppSidebar({ clinicName }: { clinicName?: string | null }) {
  const { user, logout } = useClinicAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const displayClinic = clinicName || user?.clinicName || 'Clinic workspace';
  const navItems =
    user?.role === 'clinic_doctor'
      ? doctorNav
      : user?.role === 'clinic_cashier'
        ? cashierNav
        : user?.role === 'clinic_receptionist'
          ? receptionistNav
          : managerNav;

  const settingsNavItems =
    user?.role === 'clinic_doctor' ||
    user?.role === 'clinic_cashier' ||
    user?.role === 'clinic_receptionist'
      ? staffSettingsNav
      : managerSettingsNav;

  const isSettingsActive = settingsNavItems.some(
    (item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
  );

  const [settingsOpen, setSettingsOpen] = useState(isSettingsActive);
  const prevPathRef = useRef(location.pathname);

  useEffect(() => {
    const wasSettings = prevPathRef.current.startsWith('/settings');
    const isNowSettings = location.pathname.startsWith('/settings');
    if (!wasSettings && isNowSettings) {
      setSettingsOpen(true);
    }
    prevPathRef.current = location.pathname;
  }, [location.pathname]);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="pointer-events-none">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <HeartPulse className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">HelloDoc</span>
                <span className="truncate text-xs text-muted-foreground">{displayClinic}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Clinic</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const active =
                  item.enabled &&
                  (location.pathname === item.to || location.pathname.startsWith(`${item.to}/`));
                return (
                  <SidebarMenuItem key={item.title}>
                    {item.enabled ? (
                      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                        <Link to={item.to}>
                          <item.icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    ) : (
                      <SidebarMenuButton disabled tooltip={`${item.title} (coming soon)`}>
                        <item.icon />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    )}
                  </SidebarMenuItem>
                );
              })}

              {settingsNavItems.length > 0 ? (
                <Collapsible
                  open={settingsOpen}
                  onOpenChange={setSettingsOpen}
                  className="group/collapsible"
                >
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        tooltip="Settings"
                        isActive={isSettingsActive}
                        className="cursor-pointer"
                      >
                        <Settings className="size-4" />
                        <span>Settings</span>
                        <ChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 group-data-[collapsible=icon]:hidden" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {settingsNavItems.map((item) => {
                          const active =
                            location.pathname === item.to ||
                            location.pathname.startsWith(`${item.to}/`);
                          return (
                            <SidebarMenuSubItem key={item.title}>
                              <SidebarMenuSubButton asChild isActive={active}>
                                <Link to={item.to}>
                                  <item.icon className="size-4" />
                                  <span>{item.title}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              ) : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className="rounded-lg bg-primary/15 text-primary">
                      {initials(user?.name ?? 'U')}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user?.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                side="bottom"
                align="end"
                sideOffset={4}
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar className="size-8 rounded-lg">
                      <AvatarFallback className="rounded-lg bg-primary/15 text-primary">
                        {initials(user?.name ?? 'U')}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">{user?.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={async () => {
                    await logout();
                    navigate('/login', { replace: true });
                  }}
                >
                  <LogOut />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
