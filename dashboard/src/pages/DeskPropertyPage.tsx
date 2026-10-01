/**
 * One property's intake (Listing Prep P1, SPEC_LISTING_PREP.md §4 steps 1–3):
 * the market around it (published ZIP/city data), the facts the agent confirms, the
 * seller's consent, room photos, and contractor quotes. The report (P5) only runs on
 * confirmed facts and consented photos; the database enforces both.
 */
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { ArrowLeft, Camera, ClipboardCheck, FileSignature, LineChart, Receipt, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DeskError } from '../backend/desk';
import { deskApi } from '../backend/desk';
import { CONSENT_TEXT, CONSENT_TITLE, CONSENT_VERSION, intakeApi, PROCESSING_VERSIONS, type Consent, type Finding, type Insights, type Photo, type PhotoResult, type Property, type Quote, type VisionJob } from '../backend/intake';
import { useRegionForZip } from '../data/hooks';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatDate, formatDelta, formatValue } from '../lib/format';
import {
  analysisReadiness,
  factsFromForm,
  factsProblems,
  formatDollars,
  formFromFacts,
  marketContext,
  missingCore,
  missingRooms,
  NUM_FIELDS,
  PROPERTY_TYPES,
  roomLabel,
  ROOMS,
  STATUS_LABELS,
  type CostRow,
  type Facts,
  type PropertyStatus,
  type Room,
} from '../lib/intake';
import { Button } from '../ui/controls';
import { Card, DeskFrame } from './DeskPage';
import { FindingsCard } from './desk/FindingsCard';
import { InsightsCard } from './desk/InsightsCard';

const input = 'h-11 rounded-control border border-mp-line bg-mp-panel px-3 text-mp-ink';
const errText = (e: unknown) => (e instanceof DeskError ? e.message : e instanceof Error ? e.message : 'Something went wrong. Try again.');

export function DeskPropertyPage() {
  const { id = '' } = useParams();
  const [title, setTitle] = useState<string | null>(null);
  useDocumentTitle(title ?? 'Property');
  return (
    <DeskFrame eyebrow={<Link to="/desk" className="inline-flex items-center gap-1 hover:text-mp-ink"><ArrowLeft size={13} aria-hidden="true" /> Properties</Link>} heading={title ?? 'Property'} compact>
      {(client, session) => <PropertyIntake client={client} session={session} id={id} onTitle={setTitle} />}
    </DeskFrame>
  );
}

function PropertyIntake({ client, session, id, onTitle }: { client: SupabaseClient; session: Session; id: string; onTitle: (t: string) => void }) {
  const api = intakeApi(client);
  const me = session.user.id;
  const [property, setProperty] = useState<Property | null | undefined>(undefined);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [costBook, setCostBook] = useState<CostRow[]>([]);
  const [job, setJob] = useState<VisionJob | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [results, setResults] = useState<PhotoResult[]>([]);
  const [manager, setManager] = useState(false);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const p = await api.property(id);
      setProperty(p);
      if (!p) return;
      onTitle(p.address);
      const [c, ph, q, book, j, f, members, ins] = await Promise.all([
        api.consents(id),
        api.photos(id),
        api.quotes(id),
        api.costBook(p.team_id),
        api.latestJob(id),
        api.findings(id),
        deskApi(client).members(p.team_id),
        api.insights(id),
      ]);
      setInsights(ins);
      setConsents(c);
      setPhotos(ph);
      setQuotes(q);
      setCostBook(book);
      setJob(j);
      setFindings(f);
      setManager(members.some((m) => m.user_id === me && m.role === 'manager'));
      setResults(await api.photoResults(ph.map((x) => x.id)));
    } catch (e) {
      setError(errText(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, id]);
  useEffect(() => {
    load();
  }, [load]);
  // While an analysis is queued or running, check on it every 15 seconds.
  const jobActive = job?.status === 'queued' || job?.status === 'running';
  useEffect(() => {
    if (!jobActive) return;
    const t = window.setInterval(load, 15_000);
    return () => window.clearInterval(t);
  }, [jobActive, load]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    }
    await load();
  };

  if (property === undefined) return <p className="text-mp-ink-3" role="status">Loading…</p>;
  if (property === null)
    return (
      <Card title="Property not found" testId="desk-property-missing">
        <p className="text-sm text-mp-ink-2">It may have been deleted, or it belongs to a team you’re not on.</p>
      </Card>
    );
  const consent = consents.find((c) => !c.revoked_at) ?? null;
  const analyzedIds = new Set(results.map((r) => r.photo_id));
  const readiness = analysisReadiness({
    factsConfirmed: Boolean(property.facts_confirmed_at),
    consent: consent ? { version: consent.consent_version } : null,
    processingVersions: PROCESSING_VERSIONS,
    photos: photos.length,
    pendingPhotos: photos.filter((p) => !analyzedIds.has(p.id)).length,
    jobActive,
  });
  return (
    <div className="space-y-6" data-testid="desk-property">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-mp-ink-2">
        <span>
          {property.matched_address && property.matched_address !== property.address.toUpperCase() ? <>Census match: {property.matched_address}</> : [property.city, property.zip].filter(Boolean).join(' ')}
          {property.lat === null && <span className="text-mp-ink-3"> · no map pin</span>}
        </span>
        <label className="flex items-center gap-2">
          Status
          <select className="h-9 rounded-control border border-mp-line bg-mp-panel px-2 text-mp-ink" value={property.status} onChange={(e) => act(() => api.setStatus(id, e.target.value as PropertyStatus))}>
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-mp-bad" data-testid="desk-error">
          {error}
        </p>
      )}
      <MarketCard property={property} />
      <InsightsCard insights={insights} factsConfirmed={Boolean(property.facts_confirmed_at)} />
      <FactsCard key={property.facts_confirmed_at ?? 'unconfirmed'} property={property} onSave={(f) => act(() => api.saveFacts(id, f))} onConfirm={() => act(() => api.confirmFacts(id))} />
      <ConsentCard
        consents={consents}
        manager={manager}
        onRecord={(c) => act(() => api.recordConsent(id, me, c))}
        onRevoke={(cid) => act(() => api.revokeConsent(cid))}
        onPurge={() => act(() => api.purgePhotos(id))}
      />
      <PhotosCard
        facts={property.facts}
        photos={photos}
        consent={consent}
        me={me}
        onUpload={async (room, files, progress) => {
          setError(null);
          try {
            for (let i = 0; i < files.length; i++) {
              progress(i + 1, files.length);
              await api.uploadPhoto(property.team_id, id, me, room, files[i]!);
            }
          } catch (e) {
            setError(errText(e));
          }
          await load();
        }}
        onRoom={(pid, room) => act(() => api.setPhotoRoom(pid, room))}
        onDelete={(p) => act(() => api.deletePhoto(p))}
      />
      <FindingsCard
        readiness={readiness}
        job={job}
        findings={findings}
        photos={photos}
        results={results}
        onRequest={() => act(() => api.requestAnalysis(id, me))}
        onReview={(fid, edit) => act(() => api.reviewFinding(fid, edit))}
      />
      <QuotesCard quotes={quotes} costBook={costBook} onAdd={(q) => act(() => api.addQuote(id, me, q))} onDelete={(qid) => act(() => api.deleteQuote(qid))} />
    </div>
  );
}

// ---------- market ----------

function MarketCard({ property }: { property: Property }) {
  const region = useRegionForZip(property.zip);
  const ctx = useMemo(() => (region.status === 'ready' && region.data ? marketContext(region.data, property.zip, property.place_id) : null), [region, property.zip, property.place_id]);
  const rows: Array<[string, string, string | null]> = [
    ['median_sale_price', 'Median sale price', 'currency'],
    ['median_ppsf', 'Median $/sq ft', 'currency'],
    ['median_dom', 'Days on market', 'days'],
    ['avg_sale_to_list', 'Sale-to-list', 'percent'],
    ['months_of_supply', 'Months of supply', 'decimal1'],
    ['homes_sold', 'Homes sold (3 months)', 'count'],
  ];
  const areas = ctx ? ([ctx.zip ? ['ZIP ' + ctx.zip.id, ctx.zip] : null, ctx.city ? [ctx.city.name, ctx.city] : null].filter(Boolean) as Array<[string, NonNullable<typeof ctx.zip>]>) : [];
  const explore = region.status === 'ready' && region.data ? `/explore?region=${region.data.slug}${ctx?.city ? `&city=${ctx.city.id}` : ''}${ctx?.zip ? `&zip=${ctx.zip.id}` : ''}` : null;
  return (
    <Card title="The market around it" icon={<LineChart size={16} strokeWidth={1.5} aria-hidden="true" />} testId="desk-market">
      {region.status === 'loading' ? (
        <p className="text-sm text-mp-ink-3" role="status">
          Loading the ZIP’s market…
        </p>
      ) : !ctx || areas.length === 0 ? (
        <p className="text-sm text-mp-ink-2">ZIP and city market data covers Orange County for now{property.zip ? `; ${property.zip} isn’t in it` : ''}.</p>
      ) : (
        <>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Market figures (scrolls sideways)">
            <table className="w-full min-w-[420px] text-sm">
              <caption className="sr-only">Latest market figures for the property’s ZIP and city, with year-over-year change</caption>
              <thead className="text-left text-[11px] uppercase tracking-[.06em] text-mp-ink-3">
                <tr>
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">Measure</span>
                  </th>
                  {areas.map(([label]) => (
                    <th key={label} scope="col" className="py-2 text-right font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(([key, label, fmt]) => (
                  <tr key={key} className="border-t border-mp-line">
                    <th scope="row" className="py-2 text-left font-normal text-mp-ink-2">
                      {label}
                    </th>
                    {areas.map(([name, a]) => {
                      const v = a.latest[key as keyof typeof a.latest];
                      return (
                        <td key={name} className="py-2 text-right tabular-nums text-mp-ink">
                          {formatValue(v?.value, fmt)}
                          {key === 'median_sale_price' && v?.yoy != null && <span className="ml-1.5 text-xs text-mp-ink-3">{formatDelta(v.yoy, 'percent')} YoY</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-mp-ink-3">
            {ctx.zipPriceRank && <>ZIP {ctx.zip!.id} ranks #{ctx.zipPriceRank.rank} of {ctx.zipPriceRank.of} Orange County ZIPs by median price. </>}
            {ctx.zip?.low_sample && <>Few sales in this ZIP recently, so its figures are noisy. </>}
            Redfin data through {formatDate(region.status === 'ready' ? region.data?.data_through : null)}.{' '}
            {explore && (
              <Link to={explore} className="text-mp-accent underline-offset-4 hover:underline">
                Open in the atlas
              </Link>
            )}
          </p>
        </>
      )}
    </Card>
  );
}

// ---------- facts ----------

function FactsCard({ property, onSave, onConfirm }: { property: Property; onSave: (facts: Record<string, unknown>) => Promise<void>; onConfirm: () => Promise<void> }) {
  const saved = useMemo(() => formFromFacts(property.facts), [property.facts]);
  const [form, setForm] = useState(saved);
  useEffect(() => setForm(saved), [saved]);
  const facts = factsFromForm(form);
  const problems = factsProblems(facts);
  const dirty = JSON.stringify(facts) !== JSON.stringify(factsFromForm(saved));
  const missing = missingCore(property.facts);
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const field = (k: string, label: string, el: JSX.Element, unit?: string) => (
    <label key={k} className="flex flex-col gap-1 text-sm text-mp-ink-2">
      <span>
        {label}
        {unit && <span className="text-mp-ink-3"> ({unit})</span>}
        {(['beds', 'baths', 'sqft', 'year_built', 'property_type'] as string[]).includes(k) && <span className="text-mp-ink-3"> · required</span>}
      </span>
      {el}
      {problems[k] && (
        <span className="text-xs text-mp-bad" role="alert">
          {problems[k]}
        </span>
      )}
    </label>
  );
  return (
    <Card title="Facts" icon={<ClipboardCheck size={16} strokeWidth={1.5} aria-hidden="true" />} testId="desk-facts">
      <p className="text-sm text-mp-ink-2" data-testid="desk-facts-status">
        {property.facts_confirmed_at ? (
          <span className="text-mp-good">Confirmed {formatDate(property.facts_confirmed_at)}. Editing a fact un-confirms them.</span>
        ) : (
          <>Not confirmed yet: nothing is analyzed until you confirm. Enter what you know; MLS prefill arrives with the feed.</>
        )}
      </p>
      <form
        className="mt-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!Object.keys(problems).length && dirty) onSave(facts);
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {field(
            'property_type',
            'Property type',
            <select value={form.property_type ?? ''} onChange={set('property_type')} className={input}>
              <option value="">Choose…</option>
              {PROPERTY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>,
          )}
          {NUM_FIELDS.map((f) => field(f.key, f.label, <input inputMode={f.kind === 'int' ? 'numeric' : 'decimal'} value={form[f.key] ?? ''} onChange={set(f.key)} className={input} />, f.unit))}
          {field(
            'pool',
            'Pool',
            <select value={form.pool ?? ''} onChange={set('pool')} className={input}>
              <option value="">Unknown</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>,
          )}
          {field('last_sale_date', 'Last sale date', <input type="date" value={form.last_sale_date ?? ''} onChange={set('last_sale_date')} className={input} />)}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!dirty || Object.keys(problems).length > 0}>
            Save facts
          </Button>
          <Button variant="primary" disabled={dirty || missing.length > 0 || Boolean(property.facts_confirmed_at)} onClick={onConfirm}>
            Confirm facts
          </Button>
          {!property.facts_confirmed_at && (dirty || missing.length > 0) && (
            <span className="text-xs text-mp-ink-3">{dirty ? 'Save your changes, then confirm.' : `Still needed: ${missing.map((k) => (k === 'property_type' ? 'property type' : NUM_FIELDS.find((f) => f.key === k)?.label.toLowerCase())).join(', ')}.`}</span>
          )}
        </div>
      </form>
    </Card>
  );
}

// ---------- consent ----------

function ConsentCard({
  consents,
  manager,
  onRecord,
  onRevoke,
  onPurge,
}: {
  consents: Consent[];
  manager: boolean;
  onRecord: (c: { seller_name: string; method: Consent['method']; given_on: string }) => Promise<void>;
  onRevoke: (id: string) => Promise<void>;
  onPurge: () => Promise<void>;
}) {
  const active = consents.find((c) => !c.revoked_at) ?? null;
  const revokedOnly = !active && consents.some((c) => c.revoked_at);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [name, setName] = useState('');
  const [method, setMethod] = useState<Consent['method']>('signed_form');
  const [on, setOn] = useState(() => new Date().toISOString().slice(0, 10));
  const METHODS: Record<Consent['method'], string> = { signed_form: 'Signed form', email: 'By email', in_person: 'In person' };
  return (
    <Card title="Seller’s consent for photos" icon={<FileSignature size={16} strokeWidth={1.5} aria-hidden="true" />} testId="desk-consent">
      <blockquote className="space-y-2 border-l-2 border-mp-line pl-3 text-sm text-mp-ink-2">
        <p className="font-medium text-mp-ink">{CONSENT_TITLE}</p>
        {CONSENT_TEXT.map((para, i) => (
          <p key={i}>{i === 0 ? para : `${i}. ${para}`}</p>
        ))}
      </blockquote>
      <p className="mt-1 text-xs text-mp-warn">Draft text, version {CONSENT_VERSION}: your brokerage’s counsel must review it before you use it with sellers.</p>
      {active ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm" data-testid="desk-consent-active">
          <span className="text-mp-ink">
            Given by <b>{active.seller_name}</b> ({METHODS[active.method].toLowerCase()}, {formatDate(active.given_on)}, text {active.consent_version})
          </span>
          {confirmRevoke ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-mp-ink-2">The photos will be hidden, any analysis withdrawn, and the photos deleted after 30 days.</span>
              <Button variant="primary" onClick={() => onRevoke(active.id).then(() => setConfirmRevoke(false))}>
                Confirm revocation
              </Button>
              <Button variant="quiet" onClick={() => setConfirmRevoke(false)}>
                Cancel
              </Button>
            </span>
          ) : (
            <Button variant="quiet" onClick={() => setConfirmRevoke(true)}>
              Record a revocation
            </Button>
          )}
          {!PROCESSING_VERSIONS.includes(active.consent_version) && (
            <p className="w-full text-xs text-mp-warn" data-testid="desk-consent-outdated">
              This consent was recorded under an earlier text that doesn’t cover AI analysis. Photos can be added, but nothing is analyzed until the seller consents to the current text: record a revocation, then the new consent.
            </p>
          )}
        </div>
      ) : (
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onRecord({ seller_name: name.trim(), method, given_on: on }).then(() => setName(''));
          }}
        >
          <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-sm text-mp-ink-2">
            Seller’s name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required autoComplete="off" className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-mp-ink-2">
            How
            <select value={method} onChange={(e) => setMethod(e.target.value as Consent['method'])} className={input}>
              {Object.entries(METHODS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-mp-ink-2">
            Date
            <input type="date" value={on} onChange={(e) => setOn(e.target.value)} required className={input} />
          </label>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            Record consent
          </Button>
        </form>
      )}
      {revokedOnly && (
        <div className="mt-4 rounded-control border border-mp-line p-3 text-sm text-mp-ink-2" data-testid="desk-consent-revoked">
          Consent is revoked: this property’s photos are hidden, no photo is analyzed, and any findings are withdrawn. The photos are deleted 30 days after the revocation.
          {manager && (
            <span className="mt-2 flex flex-wrap items-center gap-2">
              {confirmPurge ? (
                <>
                  <span className="text-xs">Delete every photo of this property now? This can’t be undone.</span>
                  <Button variant="primary" onClick={() => onPurge().then(() => setConfirmPurge(false))}>
                    Delete all photos
                  </Button>
                  <Button variant="quiet" onClick={() => setConfirmPurge(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="quiet" onClick={() => setConfirmPurge(true)}>
                  Delete all photos now
                </Button>
              )}
            </span>
          )}
        </div>
      )}
      {consents.some((c) => c.revoked_at) && (
        <ul className="mt-3 text-xs text-mp-ink-3">
          {consents
            .filter((c) => c.revoked_at)
            .map((c) => (
              <li key={c.id}>
                {c.seller_name}: given {formatDate(c.given_on)}, revoked {formatDate(c.revoked_at)}
              </li>
            ))}
        </ul>
      )}
    </Card>
  );
}

// ---------- photos ----------

function PhotosCard({
  facts,
  photos,
  consent,
  me,
  onUpload,
  onRoom,
  onDelete,
}: {
  facts: Facts;
  photos: Photo[];
  consent: Consent | null;
  me: string;
  onUpload: (room: Room, files: File[], progress: (n: number, of: number) => void) => Promise<void>;
  onRoom: (id: string, room: Room) => Promise<void>;
  onDelete: (p: Photo) => Promise<void>;
}) {
  const missing = missingRooms(
    facts,
    photos.map((p) => p.room),
  );
  const [room, setRoom] = useState<Room>(missing[0] ?? 'kitchen');
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = async (files: File[]) => {
    if (!files.length) return;
    await onUpload(room, files, (n, of) => setBusy(of > 1 ? `Uploading ${n} of ${of}…` : 'Uploading…'));
    setBusy(null);
  };
  const byRoom = ROOMS.map(([r]) => [r, photos.filter((p) => p.room === r)] as const).filter(([, ps]) => ps.length > 0);
  return (
    <Card title="Photos by room" icon={<Camera size={16} strokeWidth={1.5} aria-hidden="true" />} testId="desk-photos">
      {!consent ? (
        <p className="text-sm text-mp-ink-2">Record the seller’s consent above to add photos.</p>
      ) : (
        <>
          <p className="text-sm text-mp-ink-2">Photos are resized to 2048 px and their location and camera data are removed on this device before upload. Only your team can see them.</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-mp-ink-2">
              Room
              <select value={room} onChange={(e) => setRoom(e.target.value as Room)} className={input}>
                {ROOMS.map(([r, l]) => (
                  <option key={r} value={r}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="primary" icon={<Camera size={15} strokeWidth={1.5} aria-hidden="true" />} disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>
              {busy ?? 'Add photos'}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              multiple
              className="sr-only"
              aria-label={`Photos of the ${roomLabel(room).toLowerCase()}`}
              data-testid="photo-file"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                upload(files);
              }}
            />
          </div>
        </>
      )}
      <p className="mt-3 text-sm" data-testid="desk-photo-coverage">
        {missing.length ? (
          <span className="text-mp-warn">Still needed: {missing.map(roomLabel).join(', ')}.</span>
        ) : (
          <span className="text-mp-good">Every expected room has a photo.</span>
        )}
      </p>
      {byRoom.length > 0 && (
        <div className="mt-4 space-y-4">
          {byRoom.map(([r, ps]) => (
            <section key={r} aria-label={roomLabel(r)}>
              <h3 className="text-[11px] uppercase tracking-[.06em] text-mp-ink-3">
                {roomLabel(r)} · {ps.length}
              </h3>
              <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {ps.map((p, i) => (
                  <li key={p.id} className="overflow-hidden rounded-control border border-mp-line" data-testid="desk-photo">
                    {p.url ? <img src={p.url} alt={`${roomLabel(p.room)} photo ${i + 1}`} loading="lazy" className="aspect-[4/3] w-full object-cover" /> : <div className="aspect-[4/3] w-full bg-mp-panel" />}
                    <div className="flex items-center gap-1 p-1.5">
                      <select aria-label={`Room for ${roomLabel(p.room).toLowerCase()} photo ${i + 1}`} value={p.room} onChange={(e) => onRoom(p.id, e.target.value as Room)} className="h-8 min-w-0 flex-1 rounded-control border border-mp-line bg-mp-panel px-1 text-xs text-mp-ink">
                        {ROOMS.map(([rv, l]) => (
                          <option key={rv} value={rv}>
                            {l}
                          </option>
                        ))}
                      </select>
                      {p.uploaded_by === me && (
                        <button type="button" onClick={() => onDelete(p)} aria-label={`Delete ${roomLabel(p.room).toLowerCase()} photo ${i + 1}`} className="grid h-8 w-8 place-items-center rounded-control text-mp-ink-3 hover:text-mp-bad">
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------- quotes ----------

function QuotesCard({ quotes, costBook, onAdd, onDelete }: { quotes: Quote[]; costBook: CostRow[]; onAdd: (q: Omit<Quote, 'id' | 'created_by'>) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const [item, setItem] = useState('');
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  const [vendor, setVendor] = useState('');
  const [on, setOn] = useState('');
  const key = item.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const lo = Number(low.replace(/[$,]/g, ''));
  const hi = high.trim() === '' ? lo : Number(high.replace(/[$,]/g, ''));
  const valid = /^[a-z0-9_]{2,60}$/.test(key) && low.trim() !== '' && Number.isFinite(lo) && Number.isFinite(hi) && lo >= 0 && hi >= lo;
  const book = new Map(costBook.map((r) => [r.item, r]));
  return (
    <Card title="Contractor quotes" icon={<Receipt size={16} strokeWidth={1.5} aria-hidden="true" />} testId="desk-quotes">
      <p className="text-sm text-mp-ink-2">A real quote for this home overrides the cost book for that item.</p>
      <form
        className="mt-3 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onAdd({ item: key, low_usd: lo, high_usd: hi, vendor: vendor.trim() || null, notes: null, quoted_on: on || null }).then(() => {
            setItem('');
            setLow('');
            setHigh('');
            setVendor('');
          });
        }}
      >
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-sm text-mp-ink-2">
          Item
          <input list="cost-book-items" value={item} onChange={(e) => setItem(e.target.value)} placeholder="interior_paint_walls" className={input} />
          <datalist id="cost-book-items">
            {costBook.map((r) => (
              <option key={r.item} value={r.item} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-sm text-mp-ink-2">
          Low ($)
          <input inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} className={`${input} w-28`} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-mp-ink-2">
          High ($)
          <input inputMode="decimal" value={high} onChange={(e) => setHigh(e.target.value)} placeholder="same" className={`${input} w-28`} />
        </label>
        <label className="flex min-w-[160px] flex-col gap-1 text-sm text-mp-ink-2">
          Contractor
          <input value={vendor} onChange={(e) => setVendor(e.target.value)} maxLength={120} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-mp-ink-2">
          Quoted on
          <input type="date" value={on} onChange={(e) => setOn(e.target.value)} className={input} />
        </label>
        <Button type="submit" disabled={!valid}>
          Add quote
        </Button>
      </form>
      {quotes.length > 0 && (
        <ul className="mt-4 divide-y divide-mp-line text-sm" data-testid="desk-quote-list">
          {quotes.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span>
                <span className="text-mp-ink">{q.item.replace(/_/g, ' ')}</span>
                <span className="ml-2 tabular-nums text-mp-ink">{q.low_usd === q.high_usd ? formatDollars(q.low_usd) : `${formatDollars(q.low_usd)}–${formatDollars(q.high_usd)}`}</span>
                <span className="block text-xs text-mp-ink-3">
                  {[q.vendor, q.quoted_on && formatDate(q.quoted_on), book.has(q.item) ? 'overrides the cost book' : 'not in the cost book'].filter(Boolean).join(' · ')}
                </span>
              </span>
              <Button variant="quiet" onClick={() => onDelete(q.id)} aria-label={`Delete the ${q.item.replace(/_/g, ' ')} quote`}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
