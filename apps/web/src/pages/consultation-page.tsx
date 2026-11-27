import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError, openProtectedDocument } from '@/lib/api';
import { notify } from '@/lib/notify';

type Prescription = {
  id: string;
  status: string;
  version: number;
  clinical_instructions?: string | null;
  items?: Array<{ medicine_name: string; dose: string; frequency: string; instructions?: string | null }>;
};

type MedicineRow = { key: string; medicineName: string; dose: string; frequency: string; instructions: string };

function blankMedicine(): MedicineRow {
  return { key: crypto.randomUUID(), medicineName: '', dose: '', frequency: '', instructions: '' };
}

/** Returns a clear message for the first incomplete medicine, or null when all rows are valid. */
function validateMedicines(rows: MedicineRow[]): string | null {
  for (const [index, row] of rows.entries()) {
    const label = rows.length > 1 ? `Medicine ${index + 1}` : 'Medicine';
    if (row.medicineName.trim().length < 2) return `${label}: enter a medicine name (at least 2 characters)`;
    if (!row.dose.trim()) return `${label}: enter the dose`;
    if (!row.frequency.trim()) return `${label}: enter the frequency`;
  }
  return null;
}

type Encounter = {
  id: string;
  status: string;
  version: number;
  patient_id: string;
  chief_complaint: string | null;
  history_present_illness: string | null;
  examination_findings: string | null;
  assessment: string | null;
  treatment_plan: string | null;
  follow_up_instructions: string | null;
  allergies: {
    status: string;
    items: Array<{ id: string; substance: string; reaction: string | null; severity: string | null }>;
  };
  prescription?: Prescription | null;
  vitals?: Array<{
    id: string;
    systolic_mmhg: number | null;
    diastolic_mmhg: number | null;
    pulse_bpm: number | null;
    temperature_c: string | number | null;
  }>;
};

const noteClass =
  'min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60';

function allergyLabel(status: string) {
  if (status === 'NO_KNOWN_ALLERGIES') return 'No known allergies';
  if (status === 'UNKNOWN') return 'Not assessed';
  return status.replaceAll('_', ' ');
}

export function ConsultationPage() {
  const { id } = useParams();
  const [encounter, setEncounter] = useState<Encounter | null>(null);
  const [prescription, setPrescription] = useState<Prescription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [medicines, setMedicines] = useState<MedicineRow[]>(() => [blankMedicine()]);
  const [rxNotes, setRxNotes] = useState('');
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [pulse, setPulse] = useState('');
  const [temperature, setTemperature] = useState('');
  const [allergySubstance, setAllergySubstance] = useState('');
  const [allergyReaction, setAllergyReaction] = useState('');
  const [allergySeverity, setAllergySeverity] = useState('');

  const load = async () => {
    if (!id) return;
    const data = await api<Encounter>(`/clinic/encounters/${id}`);
    setEncounter(data);
    if (data.prescription) {
      setPrescription(data.prescription);
      // Reload a saved draft's medicines so they can still be edited before signing.
      if (data.prescription.status === 'DRAFT' && data.prescription.items?.length) {
        setMedicines(
          data.prescription.items.map((item) => ({
            key: crypto.randomUUID(),
            medicineName: item.medicine_name ?? '',
            dose: item.dose ?? '',
            frequency: item.frequency ?? '',
            instructions: item.instructions ?? '',
          })),
        );
        setRxNotes(data.prescription.clinical_instructions ?? '');
      }
    }
  };

  useEffect(() => {
    void load().catch((err) => setError(err instanceof ApiError ? err.message : 'Load failed'));
  }, [id]);

  if (!encounter) {
    return <p className="text-sm text-muted-foreground">{error ?? 'Loading consultation…'}</p>;
  }

  const locked = encounter.status !== 'DRAFT';
  // A signed prescription is final: shown read-only, never edited or re-created from here.
  const rxLocked = prescription?.status === 'SIGNED';
  const latestVitals = encounter.vitals?.[0];

  const setNote = (key: keyof Encounter, value: string) => {
    setEncounter({ ...encounter, [key]: value });
  };

  const saveDraft = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await api<Encounter>(`/clinic/encounters/${encounter.id}/draft`, {
        method: 'POST',
        json: {
          version: encounter.version,
          chiefComplaint: encounter.chief_complaint,
          historyPresentIllness: encounter.history_present_illness,
          examinationFindings: encounter.examination_findings,
          assessment: encounter.assessment,
          treatmentPlan: encounter.treatment_plan,
          followUpInstructions: encounter.follow_up_instructions,
        },
      });
      setEncounter(saved);
      setMessage('Draft saved');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const signEncounter = async () => {
    setBusy(true);
    setError(null);
    try {
      const signed = await api<Encounter>(`/clinic/encounters/${encounter.id}/sign`, {
        method: 'POST',
        json: { version: encounter.version },
      });
      setEncounter(signed);
      setMessage('Consultation signed');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign failed');
    } finally {
      setBusy(false);
    }
  };

  const saveVitals = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/clinic/encounters/${encounter.id}/vitals`, {
        method: 'POST',
        json: {
          systolicMmhg: systolic === '' ? undefined : Number(systolic),
          diastolicMmhg: diastolic === '' ? undefined : Number(diastolic),
          pulseBpm: pulse === '' ? undefined : Number(pulse),
          temperatureC: temperature === '' ? undefined : Number(temperature),
        },
      });
      const refreshed = await api<Encounter>(`/clinic/encounters/${encounter.id}`);
      setEncounter((current) =>
        current
          ? {
              ...current,
              version: refreshed.version,
              vitals: refreshed.vitals,
              allergies: refreshed.allergies,
            }
          : refreshed,
      );
      setMessage('Vitals recorded');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Vitals save failed');
    } finally {
      setBusy(false);
    }
  };

  // Allergy changes only refresh the allergy list. Reloading the whole consultation here would
  // overwrite clinical notes (and prescription rows) the doctor has typed but not saved yet.
  const applyAllergies = (allergies: Encounter['allergies']) => {
    setEncounter((current) => (current ? { ...current, allergies } : current));
  };

  const markNoKnownAllergies = async () => {
    setBusy(true);
    setError(null);
    try {
      const allergies = await api<Encounter['allergies']>(`/clinic/patients/${encounter.patient_id}/allergy-status`, {
        method: 'POST',
        json: { status: 'NO_KNOWN_ALLERGIES' },
      });
      applyAllergies(allergies);
      setMessage('Allergy status updated to no known allergies');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Allergy update failed');
    } finally {
      setBusy(false);
    }
  };

  const addAllergy = async () => {
    const substance = allergySubstance.trim();
    if (substance.length < 2) {
      setError('Enter the allergen (at least 2 characters), e.g. Penicillin');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const allergies = await api<Encounter['allergies']>(`/clinic/allergies`, {
        method: 'POST',
        json: {
          patientId: encounter.patient_id,
          substance,
          reaction: allergyReaction.trim() || undefined,
          severity: allergySeverity || undefined,
        },
      });
      setAllergySubstance('');
      setAllergyReaction('');
      setAllergySeverity('');
      applyAllergies(allergies);
      setMessage(`Allergy recorded: ${substance}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record allergy');
    } finally {
      setBusy(false);
    }
  };

  const removeAllergy = async (allergyId: string, substance: string) => {
    setBusy(true);
    setError(null);
    try {
      const allergies = await api<Encounter['allergies']>(`/clinic/allergies/${allergyId}/remove`, {
        method: 'POST',
        json: {},
      });
      applyAllergies(allergies);
      setMessage(`Allergy removed: ${substance}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove allergy');
    } finally {
      setBusy(false);
    }
  };

  const updateMedicine = (key: string, patch: Partial<Omit<MedicineRow, 'key'>>) => {
    setMedicines((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const savePrescription = async () => {
    const validationError = validateMedicines(medicines);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Keep editing the same draft; only start a new prescription when there is no draft yet.
      const target =
        prescription && prescription.status === 'DRAFT'
          ? prescription
          : await api<Prescription>(`/clinic/encounters/${encounter.id}/prescriptions`, {
              method: 'POST',
            });
      const drafted = await api<Prescription>(`/clinic/prescriptions/${target.id}/draft`, {
        method: 'POST',
        json: {
          version: target.version ?? 1,
          clinicalInstructions: rxNotes.trim() || undefined,
          items: medicines.map((row) => ({
            medicineName: row.medicineName.trim(),
            dose: row.dose.trim(),
            frequency: row.frequency.trim(),
            instructions: row.instructions.trim() || undefined,
          })),
        },
      });
      setPrescription(drafted);
      setMessage(`Prescription ${drafted.status.toLowerCase()}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Prescription draft failed');
    } finally {
      setBusy(false);
    }
  };

  const signPrescription = async () => {
    if (!prescription) return;
    setBusy(true);
    setError(null);
    try {
      const signed = await api<Prescription>(`/clinic/prescriptions/${prescription.id}/sign`, {
        method: 'POST',
        json: { version: prescription.version },
      });
      setPrescription(signed);
      setMessage('Prescription signed. The cashier can now bill this visit from POS.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Prescription sign failed');
    } finally {
      setBusy(false);
    }
  };

  const actions = !locked ? (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="secondary" disabled={busy} onClick={() => void saveDraft()}>
        Save draft
      </Button>
      <Button type="button" disabled={busy} className="text-white hover:text-white" onClick={() => void signEncounter()}>
        Review & sign
      </Button>
    </div>
  ) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Consultation</h1>
            <Badge tone={locked ? 'active' : 'pending'}>{encounter.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Record the clinical note, vitals, and prescription. Sign the consultation before signing a prescription.
          </p>
        </div>
        {actions}
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">{message}</p>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Clinical note</CardTitle>
              <CardDescription>Chief complaint through follow-up. Save the draft before you leave this page.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label htmlFor="chief-complaint">Chief complaint</Label>
                <textarea
                  id="chief-complaint"
                  className={`mt-1.5 ${noteClass}`}
                  disabled={locked}
                  value={encounter.chief_complaint ?? ''}
                  onChange={(event) => setNote('chief_complaint', event.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="history">History of present illness</Label>
                <textarea
                  id="history"
                  className={`mt-1.5 ${noteClass}`}
                  disabled={locked}
                  value={encounter.history_present_illness ?? ''}
                  onChange={(event) => setNote('history_present_illness', event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="examination">Examination findings</Label>
                <textarea
                  id="examination"
                  className={`mt-1.5 ${noteClass}`}
                  disabled={locked}
                  value={encounter.examination_findings ?? ''}
                  onChange={(event) => setNote('examination_findings', event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="assessment">Assessment</Label>
                <textarea
                  id="assessment"
                  className={`mt-1.5 ${noteClass}`}
                  disabled={locked}
                  value={encounter.assessment ?? ''}
                  onChange={(event) => setNote('assessment', event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="plan">Treatment plan</Label>
                <textarea
                  id="plan"
                  className={`mt-1.5 ${noteClass}`}
                  disabled={locked}
                  value={encounter.treatment_plan ?? ''}
                  onChange={(event) => setNote('treatment_plan', event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="follow-up">Follow-up</Label>
                <textarea
                  id="follow-up"
                  className={`mt-1.5 ${noteClass}`}
                  disabled={locked}
                  value={encounter.follow_up_instructions ?? ''}
                  onChange={(event) => setNote('follow_up_instructions', event.target.value)}
                />
              </div>
              {actions ? <div className="md:col-span-2 border-t border-border pt-4">{actions}</div> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>Prescription</CardTitle>
                  <CardDescription>
                    {rxLocked
                      ? 'This prescription is signed and can no longer be changed. You can review and print it.'
                      : encounter.status === 'SIGNED'
                        ? 'Add one or more medicines, save a draft, then sign and print.'
                        : 'Available after the consultation is signed.'}
                  </CardDescription>
                </div>
                {prescription ? <Badge tone={prescription.status === 'SIGNED' ? 'active' : 'pending'}>{prescription.status}</Badge> : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {rxLocked ? (
                <div className="space-y-2">
                  {(prescription?.items ?? []).map((item, index) => (
                    <div
                      key={`${item.medicine_name}-${index}`}
                      className="grid gap-1 rounded-lg border border-border bg-muted/40 px-3 py-2 sm:grid-cols-4"
                    >
                      <p className="font-medium text-foreground">{item.medicine_name}</p>
                      <p className="text-muted-foreground">{item.dose}</p>
                      <p className="text-muted-foreground">{item.frequency}</p>
                      <p className="text-muted-foreground">{item.instructions || '—'}</p>
                    </div>
                  ))}
                  {prescription?.clinical_instructions ? (
                    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                      <p className="font-medium text-foreground">Additional notes</p>
                      <p className="whitespace-pre-wrap text-muted-foreground">{prescription.clinical_instructions}</p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-3">
                  {medicines.map((row, index) => (
                    <div key={row.key} className="grid gap-3 sm:grid-cols-2 sm:items-end lg:grid-cols-[1fr_1fr_1fr_1.4fr_auto]">
                      <div>
                        <Label htmlFor={`medicine-${row.key}`}>
                          {medicines.length > 1 ? `Medicine ${index + 1}` : 'Medicine'}
                        </Label>
                        <Input
                          id={`medicine-${row.key}`}
                          className="mt-1.5"
                          placeholder="Medicine name"
                          value={row.medicineName}
                          onChange={(event) => updateMedicine(row.key, { medicineName: event.target.value })}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`dose-${row.key}`}>Dose</Label>
                        <Input
                          id={`dose-${row.key}`}
                          className="mt-1.5"
                          placeholder="1 tablet"
                          value={row.dose}
                          onChange={(event) => updateMedicine(row.key, { dose: event.target.value })}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`frequency-${row.key}`}>Frequency</Label>
                        <Input
                          id={`frequency-${row.key}`}
                          className="mt-1.5"
                          placeholder="Twice daily"
                          value={row.frequency}
                          onChange={(event) => updateMedicine(row.key, { frequency: event.target.value })}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`instructions-${row.key}`}>Instructions</Label>
                        <Input
                          id={`instructions-${row.key}`}
                          className="mt-1.5"
                          placeholder="After meals"
                          value={row.instructions}
                          onChange={(event) => updateMedicine(row.key, { instructions: event.target.value })}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={`Remove medicine ${index + 1}`}
                        title="Remove medicine"
                        disabled={busy || medicines.length === 1}
                        onClick={() => setMedicines((rows) => rows.filter((r) => r.key !== row.key))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || encounter.status !== 'SIGNED'}
                    onClick={() => setMedicines((rows) => [...rows, blankMedicine()])}
                  >
                    <Plus className="mr-1.5 size-4" />
                    Add medicine
                  </Button>
                  <div>
                    <Label htmlFor="prescription-notes">Additional notes</Label>
                    <textarea
                      id="prescription-notes"
                      className={`${noteClass} mt-1.5`}
                      placeholder="Any other advice for the patient or pharmacist"
                      value={rxNotes}
                      disabled={encounter.status !== 'SIGNED'}
                      onChange={(event) => setRxNotes(event.target.value)}
                    />
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {!rxLocked ? (
                  <>
                    <Button type="button" disabled={busy || encounter.status !== 'SIGNED' || medicines.every((row) => row.medicineName.trim() === '')} onClick={() => void savePrescription()}>
                      Save prescription draft
                    </Button>
                    <Button type="button" variant="secondary" disabled={busy || !prescription || prescription.status !== 'DRAFT'} onClick={() => void signPrescription()}>
                      Sign prescription
                    </Button>
                  </>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  disabled={!prescription || prescription.status !== 'SIGNED'}
                  onClick={async () => {
                    if (!prescription) return;
                    setError(null);
                    try {
                      await openProtectedDocument(`/clinic/prescriptions/${prescription.id}/print`, {
                        autoPrint: true,
                      });
                      setMessage('Prescription opened. Choose Save as PDF in the print dialog.');
                    } catch (err) {
                      const message =
                        err instanceof ApiError
                          ? err.message
                          : err instanceof Error
                            ? err.message
                            : 'Print failed';
                      setError(message);
                      notify.error(message);
                    }
                  }}
                >
                  Print / Save PDF
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>Allergies</CardTitle>
                <Badge tone={encounter.allergies.status === 'UNKNOWN' ? 'pending' : 'active'}>
                  {allergyLabel(encounter.allergies.status)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {encounter.allergies.status === 'UNKNOWN' ? (
                <p className="text-muted-foreground">Confirm allergies before signing. Not assessed is not the same as no known allergies.</p>
              ) : null}
              {encounter.allergies.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2"
                >
                  <p>
                    <span className="font-medium text-foreground">{item.substance}</span>
                    {item.severity ? (
                      <span className="ml-1.5 text-xs uppercase text-muted-foreground">{item.severity.toLowerCase()}</span>
                    ) : null}
                    {item.reaction ? <span className="block text-muted-foreground">{item.reaction}</span> : null}
                  </p>
                  {!locked ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      aria-label={`Remove allergy ${item.substance}`}
                      title="Remove (recorded in error)"
                      disabled={busy}
                      onClick={() => void removeAllergy(item.id, item.substance)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              ))}
              {encounter.allergies.items.length === 0 && encounter.allergies.status !== 'UNKNOWN' ? (
                <p className="text-muted-foreground">No active allergies recorded.</p>
              ) : null}
              {!locked ? (
                <div className="space-y-2 border-t border-border pt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Add allergy</p>
                  <div>
                    <Label htmlFor="allergy-substance">Allergen</Label>
                    <Input
                      id="allergy-substance"
                      className="mt-1.5"
                      placeholder="e.g. Penicillin"
                      value={allergySubstance}
                      onChange={(event) => setAllergySubstance(event.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="allergy-reaction">Reaction (optional)</Label>
                    <Input
                      id="allergy-reaction"
                      className="mt-1.5"
                      placeholder="e.g. Rash, swelling"
                      value={allergyReaction}
                      onChange={(event) => setAllergyReaction(event.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="allergy-severity">Severity (optional)</Label>
                    <select
                      id="allergy-severity"
                      className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                      value={allergySeverity}
                      onChange={(event) => setAllergySeverity(event.target.value)}
                    >
                      <option value="">Not specified</option>
                      <option value="MILD">Mild</option>
                      <option value="MODERATE">Moderate</option>
                      <option value="SEVERE">Severe</option>
                      <option value="UNKNOWN">Unknown</option>
                    </select>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy || allergySubstance.trim() === ''}
                    onClick={() => void addAllergy()}
                  >
                    <Plus className="mr-1.5 size-4" />
                    Add allergy
                  </Button>
                </div>
              ) : null}
              {!locked &&
              encounter.allergies.status !== 'NO_KNOWN_ALLERGIES' &&
              encounter.allergies.items.length === 0 ? (
                <Button type="button" variant="outline" disabled={busy} onClick={() => void markNoKnownAllergies()}>
                  Mark no known allergies
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Vitals</CardTitle>
              <CardDescription>Record the reading taken in this visit.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {latestVitals ? (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-muted/50 px-2 py-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">BP</p>
                    <p className="text-sm font-semibold text-foreground">
                      {latestVitals.systolic_mmhg ?? '—'}/{latestVitals.diastolic_mmhg ?? '—'}
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-2 py-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Pulse</p>
                    <p className="text-sm font-semibold text-foreground">{latestVitals.pulse_bpm ?? '—'}</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-2 py-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Temp</p>
                    <p className="text-sm font-semibold text-foreground">{latestVitals.temperature_c ?? '—'}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No vitals recorded for this visit.</p>
              )}
              {!locked ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="systolic">Systolic</Label>
                      <Input id="systolic" className="mt-1.5" inputMode="numeric" placeholder="120" value={systolic} onChange={(event) => setSystolic(event.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="diastolic">Diastolic</Label>
                      <Input id="diastolic" className="mt-1.5" inputMode="numeric" placeholder="80" value={diastolic} onChange={(event) => setDiastolic(event.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="pulse">Pulse</Label>
                      <Input id="pulse" className="mt-1.5" inputMode="numeric" placeholder="72" value={pulse} onChange={(event) => setPulse(event.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="temperature">Temp °C</Label>
                      <Input id="temperature" className="mt-1.5" inputMode="decimal" placeholder="36.8" value={temperature} onChange={(event) => setTemperature(event.target.value)} />
                    </div>
                  </div>
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => void saveVitals()}>
                    Save vitals
                  </Button>
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
