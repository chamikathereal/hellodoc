import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  CreditCard,
  Building2,
  FileText,
  Minus,
  Pill,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Stethoscope,
  Syringe,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PrintDocumentDialog } from '@/components/print-document-button';
import { api, ApiError } from '@/lib/api';
import { notify } from '@/lib/notify';

type Patient = {
  id: string;
  fullName: string;
  patientNumber: string;
  phone?: string;
};

type Service = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price: string;
  active: boolean;
};

type PrescriptionItem = {
  medicine_name: string;
  strength?: string | null;
  dose?: string | null;
  frequency?: string | null;
  duration?: string | null;
  instructions?: string | null;
};

type Prescription = {
  id: string;
  status: string;
  items: PrescriptionItem[];
};

/** An appointment whose prescription is signed and that has not been billed yet. */
type BillableAppointment = {
  appointmentId: string;
  bookingReference: string;
  queueDisplay: string;
  patientId: string;
  patientName: string;
  patientNumber: string;
  doctorName: string;
  localDate: string;
  startAt: string;
  endAt: string;
  signedAt: string | null;
  medicines: Array<{ medicine_name: string; dose: string | null; frequency: string | null }>;
};

function billableLabel(a: BillableAppointment): string {
  const time = new Date(a.startAt).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Colombo',
  });
  return `${a.bookingReference} · ${a.patientName} (${a.patientNumber}) · ${a.doctorName} · ${a.localDate} ${time} · Queue ${a.queueDisplay}`;
}

export type CartItem = {
  clientId: string;
  serviceId: string;
  name: string;
  code: string;
  quantity: number;
  unitPrice: string;
  discount: string;
};

type PaymentMethod = 'CASH' | 'CARD_EXTERNAL' | 'BANK_TRANSFER';

type CompletedSale = {
  invoiceId: string;
  invoiceNumber: string;
  receiptId?: string;
  receiptNumber?: string;
  patientName: string;
  grandTotal: string;
  paidAmount: string;
  changeAmount: string;
  method: string;
};

type CategoryKey = 'ALL' | 'CONSULT' | 'MEDS' | 'PROCEDURES' | 'LAB' | 'OTHER';

function getCategory(svc: Service): CategoryKey {
  const code = svc.code.toUpperCase();
  const name = svc.name.toLowerCase();
  if (code.includes('DOC') || code.includes('CONSULT') || code.includes('CLINIC') || name.includes('consult')) {
    return 'CONSULT';
  }
  if (code.includes('MED') || name.includes('medicine') || name.includes('pharmacy') || name.includes('drug')) {
    return 'MEDS';
  }
  if (code.includes('NURSING') || code.includes('PROCEDURE') || name.includes('dressing') || name.includes('procedure')) {
    return 'PROCEDURES';
  }
  if (code.includes('LAB') || code.includes('TEST') || name.includes('lab') || name.includes('investigation') || name.includes('blood')) {
    return 'LAB';
  }
  return 'OTHER';
}

function getServiceIcon(category: CategoryKey) {
  switch (category) {
    case 'CONSULT':
      return <Stethoscope className="size-4 text-emerald-600 dark:text-emerald-400" />;
    case 'MEDS':
      return <Pill className="size-4 text-sky-600 dark:text-sky-400" />;
    case 'PROCEDURES':
      return <Syringe className="size-4 text-amber-600 dark:text-amber-400" />;
    case 'LAB':
      return <Sparkles className="size-4 text-purple-600 dark:text-purple-400" />;
    default:
      return <Receipt className="size-4 text-muted-foreground" />;
  }
}

export function PosRegister({
  onInvoiceCreated,
  onSwitchToInvoices,
}: {
  onInvoiceCreated?: () => void;
  onSwitchToInvoices?: () => void;
}) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  // Active selections
  const [patientId, setPatientId] = useState('');
  const [patientSearch, setPatientSearch] = useState('');
  const [appointmentId, setAppointmentId] = useState('');
  const [rx, setRx] = useState<Prescription | null>(null);
  const [billable, setBillable] = useState<BillableAppointment[]>([]);
  const [appointmentSearch, setAppointmentSearch] = useState('');

  // Signed-prescription appointments waiting for billing (the cashier bills them here).
  const loadBillable = () => {
    void api<{ items: BillableAppointment[] }>('/clinic/billing/billable-appointments', { toast: false })
      .then((data) => setBillable(data.items ?? []))
      .catch(() => setBillable([]));
  };
  useEffect(() => {
    loadBillable();
  }, []);

  const selectedAppointment = useMemo(
    () => billable.find((a) => a.appointmentId === appointmentId) ?? null,
    [billable, appointmentId],
  );
  const filteredBillable = useMemo(() => {
    const q = appointmentSearch.trim().toLowerCase();
    if (!q) return billable;
    return billable.filter((a) => billableLabel(a).toLowerCase().includes(q));
  }, [billable, appointmentSearch]);

  const handleSelectAppointment = (id: string) => {
    setError(null);
    setAppointmentId(id);
    const appt = billable.find((a) => a.appointmentId === id);
    if (!appt) return;
    // The invoice must be for the appointment's patient, so select them too.
    setPatients((prev) =>
      prev.some((p) => p.id === appt.patientId)
        ? prev
        : [{ id: appt.patientId, fullName: appt.patientName, patientNumber: appt.patientNumber }, ...prev],
    );
    setPatientId(appt.patientId);
  };

  // Cart
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('ALL');
  const [serviceSearch, setServiceSearch] = useState('');

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [tenderedInput, setTenderedInput] = useState('');

  // Processing & Feedback
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedSale, setCompletedSale] = useState<CompletedSale | null>(null);
  const [printPreview, setPrintPreview] = useState<{ path: string; title: string } | null>(null);

  // Load patients and billing services on mount
  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const [patientsData, servicesData] = await Promise.all([
          api<{ items: Patient[] }>('/clinic/patients?limit=100&status=ACTIVE'),
          api<{ items: Service[] }>('/clinic/billing/services'),
        ]);
        setPatients(patientsData.items ?? []);
        const active = (servicesData.items ?? []).filter((s) => s.active);
        setServices(active);

        // Pre-seed cart with standard clinical visit lines if empty
        const doc = active.find((s) => s.code === 'DOC_CONSULT' || s.name.toLowerCase().includes('doctor'));
        const clinic = active.find((s) => s.code === 'CLINIC_FEE' || s.name.toLowerCase().includes('clinic'));
        const med = active.find((s) => s.code === 'MEDICINES' || s.name.toLowerCase().includes('medicine'));

        const initial: CartItem[] = [];
        if (doc) {
          initial.push({
            clientId: crypto.randomUUID(),
            serviceId: doc.id,
            name: doc.name,
            code: doc.code,
            quantity: 1,
            unitPrice: doc.price ?? '1500.00',
            discount: '0.00',
          });
        }
        if (clinic) {
          initial.push({
            clientId: crypto.randomUUID(),
            serviceId: clinic.id,
            name: clinic.name,
            code: clinic.code,
            quantity: 1,
            unitPrice: clinic.price ?? '500.00',
            discount: '0.00',
          });
        }
        if (med) {
          initial.push({
            clientId: crypto.randomUUID(),
            serviceId: med.id,
            name: med.name,
            code: med.code,
            quantity: 1,
            unitPrice: med.price ?? '0.00',
            discount: '0.00',
          });
        }
        if (initial.length > 0) {
          setCart(initial);
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load POS data');
      } finally {
        setLoading(false);
      }
    }
    void init();
  }, []);

  // Check for prescriptions whenever appointmentId is entered
  useEffect(() => {
    const trimmed = appointmentId.trim();
    if (!trimmed || trimmed.length < 32) {
      setRx(null);
      return;
    }
    void api<Prescription | null>(`/clinic/appointments/${trimmed}/prescription`, { toast: false })
      .then((data) => setRx(data))
      .catch(() => setRx(null));
  }, [appointmentId]);

  // Selected patient details
  const selectedPatient = useMemo(
    () => patients.find((p) => p.id === patientId),
    [patients, patientId],
  );

  // Filtered patients for dropdown/search
  const filteredPatients = useMemo(() => {
    if (!patientSearch.trim()) return patients.slice(0, 30);
    const q = patientSearch.toLowerCase();
    return patients
      .filter((p) => p.fullName.toLowerCase().includes(q) || p.patientNumber.toLowerCase().includes(q))
      .slice(0, 30);
  }, [patients, patientSearch]);

  // Filtered services for catalog grid
  const filteredServices = useMemo(() => {
    return services.filter((s) => {
      const matchCat = activeCategory === 'ALL' || getCategory(s) === activeCategory;
      const matchSearch =
        !serviceSearch.trim() ||
        s.name.toLowerCase().includes(serviceSearch.toLowerCase()) ||
        s.code.toLowerCase().includes(serviceSearch.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [services, activeCategory, serviceSearch]);

  // Cart operations
  const addToCart = (svc: Service) => {
    setError(null);
    setCart((prev) => {
      const existing = prev.find((item) => item.serviceId === svc.id);
      if (existing) {
        return prev.map((item) =>
          item.serviceId === svc.id
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }
      return [
        ...prev,
        {
          clientId: crypto.randomUUID(),
          serviceId: svc.id,
          name: svc.name,
          code: svc.code,
          quantity: 1,
          unitPrice: svc.price ?? '0.00',
          discount: '0.00',
        },
      ];
    });
  };

  const updateCartItem = (clientId: string, patch: Partial<CartItem>) => {
    setCart((prev) =>
      prev.map((item) => (item.clientId === clientId ? { ...item, ...patch } : item)),
    );
  };

  const removeCartItem = (clientId: string) => {
    setCart((prev) => prev.filter((item) => item.clientId !== clientId));
  };

  const clearCart = () => {
    setCart([]);
    setError(null);
  };

  const loadStandardVisit = () => {
    const doc = services.find((s) => s.code === 'DOC_CONSULT' || s.name.toLowerCase().includes('doctor'));
    const clinic = services.find((s) => s.code === 'CLINIC_FEE' || s.name.toLowerCase().includes('clinic'));
    const med = services.find((s) => s.code === 'MEDICINES' || s.name.toLowerCase().includes('medicine'));

    const items: CartItem[] = [];
    if (doc) items.push({ clientId: crypto.randomUUID(), serviceId: doc.id, name: doc.name, code: doc.code, quantity: 1, unitPrice: doc.price ?? '1500.00', discount: '0.00' });
    if (clinic) items.push({ clientId: crypto.randomUUID(), serviceId: clinic.id, name: clinic.name, code: clinic.code, quantity: 1, unitPrice: clinic.price ?? '500.00', discount: '0.00' });
    if (med) items.push({ clientId: crypto.randomUUID(), serviceId: med.id, name: med.name, code: med.code, quantity: 1, unitPrice: med.price ?? '0.00', discount: '0.00' });
    setCart(items);
  };

  // Financial calculations
  const subtotal = useMemo(() => {
    return cart.reduce((acc, item) => {
      const amt = Number(item.unitPrice) || 0;
      const qty = Math.max(1, item.quantity || 1);
      return acc + amt * qty;
    }, 0);
  }, [cart]);

  const discountTotal = useMemo(() => {
    return cart.reduce((acc, item) => {
      const disc = Number(item.discount) || 0;
      return acc + disc;
    }, 0);
  }, [cart]);

  const grandTotal = useMemo(() => {
    return Math.max(0, subtotal - discountTotal);
  }, [subtotal, discountTotal]);

  // Cash tendered calculation
  const tenderedNumber = Number(tenderedInput) || grandTotal;
  const changeDue = Math.max(0, tenderedNumber - grandTotal);
  const isShortCash = paymentMethod === 'CASH' && tenderedInput.trim() !== '' && Number(tenderedInput) < grandTotal;

  // Checkout Handler: Charge & Issue Receipt
  const handleChargeAndIssue = async () => {
    setError(null);
    if (!patientId) {
      const message = 'Please select a patient before charging the bill.';
      setError(message);
      notify.validation(message);
      return;
    }
    if (cart.length === 0) {
      const message = 'Cart is empty. Please add at least one item from the catalog.';
      setError(message);
      notify.validation(message);
      return;
    }
    if (isShortCash) {
      const message = 'Tendered cash is less than the Grand Total.';
      setError(message);
      notify.validation(message);
      return;
    }

    setProcessing(true);
    try {
      // Step 1: Create Invoice
      const created = await api<{ id: string }>('/clinic/invoices', {
        method: 'POST',
        json: {
          patientId,
          appointmentId: appointmentId.trim() || undefined,
          items: cart.map((item) => ({
            serviceId: item.serviceId,
            quantity: item.quantity,
            unitPrice: item.unitPrice.trim() || '0.00',
            discount: item.discount.trim() || '0.00',
          })),
        },
      });

      // Step 2: Issue Invoice (locks and gives sequential INV-...)
      const issued = await api<{
        id: string;
        invoiceNumber: string;
        invoiceTotal: string;
      }>(`/clinic/invoices/${created.id}/issue`, {
        method: 'POST',
        json: {},
      });

      // Step 3: Record Payment & Settle
      const paid = await api<{
        id: string;
        invoiceNumber: string;
        payments: Array<{ id: string; receipt_number: string; amount: string; method: string }>;
      }>(`/clinic/invoices/${created.id}/payments`, {
        method: 'POST',
        json: {
          amount: grandTotal.toFixed(2),
          method: paymentMethod,
          idempotencyKey: crypto.randomUUID(),
        },
      });

      const receipt = paid.payments?.[0];

      setCompletedSale({
        invoiceId: issued.id,
        invoiceNumber: issued.invoiceNumber,
        receiptId: receipt?.id,
        receiptNumber: receipt?.receipt_number,
        patientName: selectedPatient?.fullName ?? 'Patient',
        grandTotal: grandTotal.toFixed(2),
        paidAmount: grandTotal.toFixed(2),
        changeAmount: changeDue.toFixed(2),
        method: paymentMethod,
      });

      onInvoiceCreated?.();
      loadBillable();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to process POS checkout');
    } finally {
      setProcessing(false);
    }
  };

  // Save Draft (Pay Later) Handler
  const handleSaveDraft = async () => {
    setError(null);
    if (!patientId) {
      const message = 'Please select a patient before saving draft.';
      setError(message);
      notify.validation(message);
      return;
    }
    if (cart.length === 0) {
      const message = 'Cart is empty. Please add items to invoice.';
      setError(message);
      notify.validation(message);
      return;
    }

    setProcessing(true);
    try {
      await api<{ id: string }>('/clinic/invoices', {
        method: 'POST',
        json: {
          patientId,
          appointmentId: appointmentId.trim() || undefined,
          items: cart.map((item) => ({
            serviceId: item.serviceId,
            quantity: item.quantity,
            unitPrice: item.unitPrice.trim() || '0.00',
            discount: item.discount.trim() || '0.00',
          })),
        },
      });

      onInvoiceCreated?.();
      loadBillable();
      onSwitchToInvoices?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save draft invoice');
    } finally {
      setProcessing(false);
    }
  };

  const handleNextPatient = () => {
    setCompletedSale(null);
    setPatientId('');
    setAppointmentId('');
    setAppointmentSearch('');
    setRx(null);
    setTenderedInput('');
    loadStandardVisit();
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* ======================================================== */}
      {/* LEFT PANEL: Patient Selection & Service Catalog (7 cols) */}
      {/* ======================================================== */}
      <div className="space-y-4 lg:col-span-7">
        {/* Patient & Appointment Context Card */}
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center justify-between">
              <span className="flex items-center gap-2">
                <UserCheck className="size-4 text-primary" />
                Patient & Visit Context
              </span>
              {selectedPatient ? (
                <Badge tone="active" className="font-mono text-xs">
                  {selectedPatient.patientNumber}
                </Badge>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Patient Selector with Search */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Select Patient *</Label>
                  {patientSearch ? (
                    <button
                      type="button"
                      onClick={() => setPatientSearch('')}
                      className="text-[10px] text-muted-foreground hover:underline"
                    >
                      Clear search
                    </button>
                  ) : null}
                </div>
                <Input
                  placeholder="Type name or phone to filter..."
                  value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                  className="h-7 text-xs mb-1"
                />
                <select
                  className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                  value={patientId}
                  onChange={(e) => {
                    setPatientId(e.target.value);
                    // An appointment belongs to one patient; picking someone else unlinks it.
                    if (selectedAppointment && selectedAppointment.patientId !== e.target.value) {
                      setAppointmentId('');
                    }
                  }}
                >
                  <option value="">-- Choose Patient ({filteredPatients.length} shown) --</option>
                  {filteredPatients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName} ({p.patientNumber})
                    </option>
                  ))}
                </select>
              </div>

              {/* Appointment with a signed prescription, waiting for billing */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Appointment (Optional)</Label>
                  <button
                    type="button"
                    onClick={loadBillable}
                    className="text-[10px] text-muted-foreground hover:underline"
                  >
                    Refresh list
                  </button>
                </div>
                <Input
                  placeholder="Filter by ref, patient, doctor or date..."
                  value={appointmentSearch}
                  onChange={(e) => setAppointmentSearch(e.target.value)}
                  className="h-7 text-xs mb-1"
                />
                <select
                  className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus:ring-1 focus:ring-primary"
                  value={appointmentId}
                  onChange={(e) => handleSelectAppointment(e.target.value)}
                >
                  <option value="">
                    {billable.length
                      ? `-- No appointment (${filteredBillable.length} ready for billing) --`
                      : '-- No signed prescriptions waiting for billing --'}
                  </option>
                  {selectedAppointment && !filteredBillable.includes(selectedAppointment) ? (
                    <option value={selectedAppointment.appointmentId}>{billableLabel(selectedAppointment)}</option>
                  ) : null}
                  {filteredBillable.map((a) => (
                    <option key={a.appointmentId} value={a.appointmentId}>
                      {billableLabel(a)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Prescriptions Notice Pill if Detected */}
            {rx && rx.items.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal-500/30 bg-teal-500/10 p-2.5 text-xs text-teal-950 dark:text-teal-200">
                <div className="flex items-center gap-2">
                  <Pill className="size-4 text-teal-600 dark:text-teal-400" />
                  <span>
                    <strong className="font-semibold">{rx.items.length} Doctor Prescribed Medicines</strong> detected for this visit:{' '}
                    {rx.items
                      .map((item) => [item.medicine_name, item.dose, item.frequency].filter(Boolean).join(' '))
                      .join(', ')}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs bg-background/80"
                  onClick={() => {
                    const medSvc = services.find((s) => s.code === 'MEDICINES');
                    if (medSvc) addToCart(medSvc);
                  }}
                >
                  Include Medicines in Bill
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Service Catalog Section */}
        <Card className="border-border shadow-xs">
          <CardHeader className="space-y-3 pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                Service & Item Catalog
              </CardTitle>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={loadStandardVisit}
                className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1"
              >
                <RotateCcw className="size-3" />
                Reset Standard Visit
              </Button>
            </div>

            {/* Category Filter Pills & Search */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-1">
                {(
                  [
                    ['ALL', 'All Items'],
                    ['CONSULT', 'Consultation'],
                    ['MEDS', 'Medicines'],
                    ['PROCEDURES', 'Procedures'],
                    ['LAB', 'Lab Tests'],
                  ] as const
                ).map(([cat, label]) => (
                  <Button
                    key={cat}
                    type="button"
                    size="sm"
                    variant={activeCategory === cat ? 'default' : 'outline'}
                    onClick={() => setActiveCategory(cat)}
                    className="h-7 px-2.5 text-xs cursor-pointer"
                  >
                    {label}
                  </Button>
                ))}
              </div>

              <div className="relative sm:w-48">
                <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={serviceSearch}
                  onChange={(e) => setServiceSearch(e.target.value)}
                  placeholder="Search catalog..."
                  className="h-7 pl-7 text-xs"
                />
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {loading ? (
              <div className="flex h-36 items-center justify-center text-xs text-muted-foreground gap-2">
                <RefreshCw className="size-4 animate-spin text-primary" />
                <span>Loading catalog services...</span>
              </div>
            ) : (
              /* Catalog Grid */
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3">
                {filteredServices.map((svc) => {
                  const cat = getCategory(svc);
                  const isInCart = cart.some((c) => c.serviceId === svc.id);
                  return (
                    <button
                      key={svc.id}
                      type="button"
                      onClick={() => addToCart(svc)}
                      className={`flex flex-col justify-between rounded-lg border p-3 text-left transition-all hover:border-primary/50 hover:bg-muted/50 focus:outline-hidden cursor-pointer ${
                        isInCart
                          ? 'border-primary/40 bg-primary/5 dark:bg-primary/10'
                          : 'border-border bg-card'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="flex size-7 items-center justify-center rounded-md bg-muted">
                            {getServiceIcon(cat)}
                          </div>
                          <Badge tone="default" className="text-[10px] font-mono px-1 py-0">
                            {svc.code}
                          </Badge>
                        </div>
                        <p className="font-medium text-xs text-foreground line-clamp-1">{svc.name}</p>
                        {svc.description ? (
                          <p className="text-[11px] text-muted-foreground line-clamp-1">
                            {svc.description}
                          </p>
                        ) : null}
                      </div>

                      <div className="mt-2.5 flex items-center justify-between pt-2 border-t border-border/60">
                        <span className="font-semibold text-xs text-foreground">
                          LKR {Number(svc.price).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                        <span className="text-[11px] font-medium text-primary flex items-center gap-0.5">
                          <Plus className="size-3" /> Add
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ======================================================== */}
      {/* RIGHT PANEL: Live POS Order Slip & Checkout (5 cols)     */}
      {/* ======================================================== */}
      <div className="space-y-4 lg:col-span-5">
        <Card className="border-border shadow-md sticky top-6">
          <CardHeader className="flex flex-row items-center justify-between border-b pb-3">
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                <Receipt className="size-4 text-primary" />
                POS Order Slip
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {selectedPatient ? selectedPatient.fullName : 'No patient selected'}
              </p>
            </div>
            {cart.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearCart}
                className="h-7 text-xs text-destructive hover:bg-destructive/10"
              >
                Clear
              </Button>
            ) : null}
          </CardHeader>

          <CardContent className="space-y-4 pt-4">
            {error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            {/* Cart Items List */}
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                  <Receipt className="size-8 opacity-40 mb-1" />
                  <p className="text-xs font-medium">Cart is empty</p>
                  <p className="text-[11px]">Click items from the catalog to add them.</p>
                </div>
              ) : (
                cart.map((item) => {
                  const lineTotal = Math.max(
                    0,
                    item.quantity * (Number(item.unitPrice) || 0) - (Number(item.discount) || 0),
                  );
                  return (
                    <div
                      key={item.clientId}
                      className="rounded-lg border border-border bg-card p-2.5 text-xs space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-foreground">{item.name}</p>
                          <p className="text-[10px] font-mono text-muted-foreground">{item.code}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeCartItem(item.clientId)}
                          className="text-muted-foreground hover:text-destructive cursor-pointer p-0.5"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>

                      {/* Line Item Controls: Qty, Unit Price, Discount */}
                      <div className="grid grid-cols-12 gap-2 items-center">
                        {/* Qty Stepper */}
                        <div className="col-span-4 flex items-center rounded-md border border-input bg-background">
                          <button
                            type="button"
                            onClick={() =>
                              item.quantity > 1
                                ? updateCartItem(item.clientId, { quantity: item.quantity - 1 })
                                : removeCartItem(item.clientId)
                            }
                            className="p-1 hover:bg-muted text-muted-foreground cursor-pointer"
                          >
                            <Minus className="size-3" />
                          </button>
                          <span className="flex-1 text-center font-mono font-medium text-xs">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              updateCartItem(item.clientId, { quantity: item.quantity + 1 })
                            }
                            className="p-1 hover:bg-muted text-muted-foreground cursor-pointer"
                          >
                            <Plus className="size-3" />
                          </button>
                        </div>

                        {/* Price Input */}
                        <div className="col-span-4">
                          <Input
                            type="text"
                            value={item.unitPrice}
                            onChange={(e) =>
                              updateCartItem(item.clientId, { unitPrice: e.target.value })
                            }
                            placeholder="Price"
                            className="h-7 text-xs font-mono text-right"
                          />
                        </div>

                        {/* Line Total */}
                        <div className="col-span-4 text-right font-semibold text-foreground font-mono">
                          LKR {lineTotal.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Financial Summary */}
            <div className="border-t border-border pt-3 space-y-1.5 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="font-mono">LKR {subtotal.toFixed(2)}</span>
              </div>
              {discountTotal > 0 ? (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                  <span>Discounts</span>
                  <span className="font-mono">- LKR {discountTotal.toFixed(2)}</span>
                </div>
              ) : null}
              <div className="flex justify-between text-base font-bold text-foreground pt-1 border-t border-border">
                <span>Grand Total</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400">
                  LKR {grandTotal.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Payment Method Selector */}
            <div className="space-y-2 pt-2 border-t border-border">
              <Label className="text-xs text-muted-foreground">Payment Method</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ['CASH', 'Cash', Banknote],
                    ['CARD_EXTERNAL', 'Card (POS)', CreditCard],
                    ['BANK_TRANSFER', 'Bank Transfer', Building2],
                  ] as const
                ).map(([m, label, Icon]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPaymentMethod(m)}
                    className={`flex flex-col items-center justify-center p-2 rounded-lg border text-xs gap-1 transition-all cursor-pointer ${
                      paymentMethod === m
                        ? 'border-primary bg-primary/10 text-primary font-semibold'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <Icon className="size-4" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              {/* Cash Tender & Change Due Helper */}
              {paymentMethod === 'CASH' ? (
                <div className="rounded-lg border border-border bg-muted/40 p-2.5 space-y-2 mt-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Cash Tendered (LKR):</span>
                    <Input
                      type="number"
                      value={tenderedInput}
                      onChange={(e) => setTenderedInput(e.target.value)}
                      placeholder={grandTotal.toFixed(2)}
                      className="h-7 w-28 text-right font-mono text-xs"
                    />
                  </div>

                  {/* Quick Tender Pills */}
                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setTenderedInput(grandTotal.toFixed(2))}
                      className="h-6 text-[10px] px-1.5"
                    >
                      Exact
                    </Button>
                    {[500, 1000, 2000, 5000].map((val) => (
                      <Button
                        key={val}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setTenderedInput(String(val))}
                        className="h-6 text-[10px] px-1.5 font-mono"
                      >
                        +{val}
                      </Button>
                    ))}
                  </div>

                  {/* Change Due Display */}
                  <div className="flex items-center justify-between pt-1 text-xs border-t border-border/60">
                    <span className="font-medium text-muted-foreground">Change Due:</span>
                    <span
                      className={`font-mono font-bold ${
                        isShortCash ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {isShortCash ? 'Insufficient Cash' : `LKR ${changeDue.toFixed(2)}`}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Action Buttons */}
            <div className="space-y-2 pt-2">
              <Button
                type="button"
                size="lg"
                disabled={processing || cart.length === 0 || !patientId}
                onClick={() => void handleChargeAndIssue()}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer gap-2"
              >
                <CheckCircle2 className="size-4" />
                {processing ? 'Processing Sale...' : `Charge & Issue (LKR ${grandTotal.toFixed(2)})`}
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={processing || cart.length === 0 || !patientId}
                onClick={() => void handleSaveDraft()}
                className="w-full text-xs cursor-pointer"
              >
                Save as Draft (Pay Later)
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ======================================================== */}
      {/* MODAL: POS Receipt & Completion Dialog                   */}
      {/* ======================================================== */}
      {completedSale ? (
        <Dialog
          open={!printPreview}
          onOpenChange={(open) => {
            if (!open && !printPreview) handleNextPatient();
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader className="text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 mb-2">
                <CheckCircle2 className="size-6" />
              </div>
              <DialogTitle className="text-lg font-bold">Payment Settled Successfully!</DialogTitle>
              <DialogDescription className="text-xs">
                Invoice and payment receipt have been recorded.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Patient:</span>
                <span className="font-semibold">{completedSale.patientName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Invoice No:</span>
                <span className="font-mono font-medium">{completedSale.invoiceNumber}</span>
              </div>
              {completedSale.receiptNumber ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Receipt No:</span>
                  <span className="font-mono font-medium">{completedSale.receiptNumber}</span>
                </div>
              ) : null}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Payment Method:</span>
                <span className="font-medium">{completedSale.method}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 text-sm font-bold">
                <span>Amount Paid:</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400">
                  LKR {completedSale.paidAmount}
                </span>
              </div>
              {Number(completedSale.changeAmount) > 0 ? (
                <div className="flex justify-between text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <span>Change Given:</span>
                  <span className="font-mono">LKR {completedSale.changeAmount}</span>
                </div>
              ) : null}
            </div>

            <DialogFooter className="flex flex-col sm:flex-row gap-2">
              {completedSale.receiptId ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setPrintPreview({
                      path: `/clinic/payments/${completedSale.receiptId}/receipt`,
                      title: `Receipt ${completedSale.receiptNumber ?? ''}`.trim(),
                    })
                  }
                  className="gap-1.5"
                >
                  <Printer className="size-3.5" />
                  Print Receipt
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setPrintPreview({
                    path: `/clinic/invoices/${completedSale.invoiceId}/print`,
                    title: `Invoice ${completedSale.invoiceNumber}`,
                  })
                }
                className="gap-1.5"
              >
                <FileText className="size-3.5" />
                Print bill
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleNextPatient}
                className="bg-primary text-primary-foreground font-semibold text-white hover:text-white"
              >
                Next Patient
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      <PrintDocumentDialog
        open={!!printPreview}
        onOpenChange={(open) => {
          if (!open) setPrintPreview(null);
        }}
        path={printPreview?.path ?? null}
        title={printPreview?.title ?? 'Print preview'}
        description="Preview this bill on this page, then print or save it as a PDF."
      />
    </div>
  );
}
