/**
 * The team's properties (Listing Prep P1): the list, and adding one by address. The
 * address goes through the Census geocoder (the `geocode` Edge Function); the agent picks
 * the right match. When the geocoder can't find it (new streets often aren't in its
 * address ranges yet), the agent enters the ZIP and continues without a map pin.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { Home, MapPin, Plus } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DeskError, type Team } from '../../backend/desk';
import { intakeApi, type GeocodeMatch, type PropertySummary } from '../../backend/intake';
import { formatDate } from '../../lib/format';
import { STATUS_LABELS } from '../../lib/intake';
import { Button } from '../../ui/controls';
import { Card } from '../DeskPage';


const input = 'h-11 rounded-control border border-mp-line bg-mp-panel px-3 text-mp-ink';

export function PropertiesPanel({ client, team, me }: { client: SupabaseClient; team: Team; me: string }) {
  const api = intakeApi(client);
  const [rows, setRows] = useState<PropertySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api.properties(team.id));
    } catch (e) {
      setError(e instanceof DeskError ? e.message : 'Something went wrong. Try again.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, team.id]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="text-sm text-mp-bad">
          {error}
        </p>
      )}
      {adding ? (
        <AddProperty client={client} team={team} me={me} onCancel={() => setAdding(false)} />
      ) : (
        <Button variant="primary" icon={<Plus size={15} strokeWidth={1.75} aria-hidden="true" />} onClick={() => setAdding(true)}>
          Add a property
        </Button>
      )}
      <Card title={`${team.name} · properties`} icon={<Home size={16} strokeWidth={1.5} aria-hidden="true" />} testId="desk-properties">
        {rows === null ? (
          <p className="text-sm text-mp-ink-3" role="status">
            Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-mp-ink-2">No properties yet. Add the first one by its address: you’ll confirm its facts, record the seller’s consent and upload room photos for listing prep.</p>
        ) : (
          <ul className="divide-y divide-mp-line">
            {rows.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                <Link to={`/desk/property/${p.id}`} className="font-medium text-mp-ink underline-offset-4 hover:underline">
                  {p.address}
                </Link>
                <span className="flex flex-wrap items-center gap-x-3 text-xs text-mp-ink-3">
                  <span>{[p.city, p.zip].filter(Boolean).join(' ') || 'No ZIP'}</span>
                  <span>{STATUS_LABELS[p.status]}</span>
                  <span className={p.facts_confirmed_at ? 'text-mp-good' : ''}>{p.facts_confirmed_at ? 'Facts confirmed' : 'Facts to confirm'}</span>
                  <span>Added {formatDate(p.created_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function AddProperty({ client, team, me, onCancel }: { client: SupabaseClient; team: Team; me: string; onCancel: () => void }) {
  const api = intakeApi(client);
  const navigate = useNavigate();
  const [address, setAddress] = useState('');
  const [state, setState] = useState<'idle' | 'looking' | 'saving'>('idle');
  const [matches, setMatches] = useState<GeocodeMatch[] | null>(null);
  const [pick, setPick] = useState(0);
  const [zip, setZip] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lookupFailed, setLookupFailed] = useState(false);

  const lookUp = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLookupFailed(false);
    setState('looking');
    try {
      const m = await api.geocode(address);
      setMatches(m);
      setPick(0);
    } catch (err) {
      setMatches([]);
      setLookupFailed(true);
      setError(err instanceof DeskError ? err.message : 'The address lookup failed.');
    } finally {
      setState('idle');
    }
  };

  const save = async (match: GeocodeMatch | null) => {
    setError(null);
    setState('saving');
    try {
      const id = await api.addProperty(
        team.id,
        me,
        match
          ? { address: address.trim(), matched_address: match.matchedAddress, lat: match.lat, lon: match.lon, zip: match.zip, city: match.placeName ?? match.city, place_id: match.placeId, tract: match.tract, county_fips: match.countyFips }
          : { address: address.trim(), zip },
      );
      navigate(`/desk/property/${id}`);
    } catch (err) {
      setError(err instanceof DeskError ? err.message : 'Something went wrong. Try again.');
      setState('idle');
    }
  };

  return (
    <Card title="Add a property" icon={<MapPin size={16} strokeWidth={1.5} aria-hidden="true" />} testId="desk-add-property">
      <form onSubmit={lookUp} className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[260px] flex-1 flex-col gap-1 text-sm text-mp-ink-2">
          Street address
          <input
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setMatches(null);
            }}
            required
            maxLength={200}
            autoComplete="street-address"
            placeholder="1 Civic Center Plaza, Irvine, CA 92606"
            className={input}
          />
        </label>
        <Button type="submit" disabled={address.trim().length < 6 || state !== 'idle'}>
          {state === 'looking' ? 'Looking up…' : 'Look up'}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-mp-bad">
          {error}
        </p>
      )}
      {matches && matches.length > 0 && (
        <fieldset className="mt-4" data-testid="desk-matches">
          <legend className="text-sm text-mp-ink-2">{matches.length === 1 ? 'The Census Bureau matched this address:' : 'Pick the right match:'}</legend>
          <div className="mt-2 space-y-1.5">
            {matches.map((m, i) => (
              <label key={`${m.matchedAddress}-${i}`} className="flex items-start gap-2 text-sm text-mp-ink">
                <input type="radio" name="match" checked={pick === i} onChange={() => setPick(i)} className="mt-1" />
                <span>
                  {m.matchedAddress}
                  <span className="block text-xs text-mp-ink-3">
                    {[m.placeName ?? m.city, m.zip, m.countyFips === '06059' ? 'Orange County' : m.countyFips ? 'outside Orange County' : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <Button variant="primary" className="mt-3" disabled={state !== 'idle'} onClick={() => save(matches[pick] ?? null)}>
            {state === 'saving' ? 'Adding…' : 'Add this property'}
          </Button>
        </fieldset>
      )}
      {matches && matches.length === 0 && (
        <div className="mt-4" data-testid="desk-no-match">
          {!lookupFailed && <p className="text-sm text-mp-ink-2">The Census Bureau’s address list doesn’t have this one (newer streets often aren’t in it yet). Check the spelling, or enter the ZIP to add it without a map pin.</p>}
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-mp-ink-2">
              ZIP code
              <input value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))} inputMode="numeric" autoComplete="postal-code" className={`${input} w-28`} />
            </label>
            <Button variant="primary" disabled={zip.length !== 5 || state !== 'idle'} onClick={() => save(null)}>
              {state === 'saving' ? 'Adding…' : 'Add without a pin'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
