import { useState, useEffect } from 'react';
import axios from 'axios';

// ---------------------------------------------------------------------------
// Shopping Attribution Modal
//
// Shown after the user presses "Finish" in shopping-mode continuous scanner
// (when scanCount > 0). Two-step picker: who did the shopping, who did the
// scanning. Each step is multi-select with a "Skip" option.
//
// On submit, fans out one POST /api/chores/shopping-hook/complete per
// (chore, person) pair. The shopping chore's follow-up is suppressed when
// at least one scanner is picked.
//
// Celebration popups (level-up / badges / power-ups) are not shown here —
// they appear in HA-chores on its next mount via pending_celebrations.
// ---------------------------------------------------------------------------

const STEP_LOADING_CONFIG = 'loading_config';
const STEP_NOT_CONFIGURED = 'not_configured';
const STEP_SHOPPERS = 'shoppers';
const STEP_SCANNERS = 'scanners';
const STEP_CHECKING = 'checking';
const STEP_CONFIRM_DUPES = 'confirm_dupes';
const STEP_SUBMITTING = 'submitting';

export default function ShoppingAttributionModal({
  choresApi,
  ingressPath,
  scanCount,
  onClose,
  onToast,
}) {
  const [step, setStep] = useState(STEP_LOADING_CONFIG);
  const [persons, setPersons] = useState([]);
  const [shoppingChoreId, setShoppingChoreId] = useState(null);
  const [scanChoreId, setScanChoreId] = useState(null);

  const [shoppers, setShoppers] = useState([]);
  const [scanners, setScanners] = useState([]);
  // Recent shopping/scanning completions for any of the picked people,
  // populated by the dupe-check pass that runs before submit.
  // Shape: [{ entity_id, name, chore_name, minutes_ago }]
  const [recentHits, setRecentHits] = useState([]);

  // Load config + persons on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [personsResp, shopCfg, scanCfg] = await Promise.all([
          axios.get(`${choresApi}/persons/`),
          axios.get(`${choresApi}/config/shopping_chore_id`).catch(() => null),
          axios.get(`${choresApi}/config/scan_chore_id`).catch(() => null),
        ]);
        if (cancelled) return;
        setPersons(personsResp.data || []);
        const sid = parseInt(shopCfg?.data?.value, 10);
        const cid = parseInt(scanCfg?.data?.value, 10);
        if (Number.isFinite(sid) && Number.isFinite(cid)) {
          setShoppingChoreId(sid);
          setScanChoreId(cid);
          setStep(STEP_SHOPPERS);
        } else {
          setStep(STEP_NOT_CONFIGURED);
        }
      } catch (err) {
        if (cancelled) return;
        onToast?.(
          `Couldn't reach Chores (${err?.message ?? 'network error'}).`,
          'error',
        );
        onClose?.();
      }
    })();
    return () => { cancelled = true; };
    // Run once on mount only. choresApi/onClose/onToast are intentionally
    // omitted: parent re-renders shouldn't restart the config fetch or
    // tear down the modal mid-flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePick = (list, setter, entityId) => {
    setter(list.includes(entityId)
      ? list.filter((x) => x !== entityId)
      : [...list, entityId]);
  };

  // Look up recent shopping/scanning completions for every person who is
  // about to be credited. If any person has already done shopping or
  // scanning within the last hour (server-defined window), divert to a
  // confirmation step before firing the attribution POSTs. A failed
  // lookup never blocks: we proceed to submit and let the user move on.
  const checkAndSubmit = async () => {
    const uniquePersons = Array.from(new Set([...shoppers, ...scanners]));
    if (uniquePersons.length === 0) {
      onClose?.();
      return;
    }
    setStep(STEP_CHECKING);
    const choreIds = [shoppingChoreId, scanChoreId].join(',');
    try {
      const results = await Promise.all(uniquePersons.map((p) =>
        axios
          .get(`${choresApi}/completions/recent`, { params: { person: p, chore_ids: choreIds } })
          .then((r) => ({ person: p, rows: r.data || [] }))
          .catch(() => ({ person: p, rows: [] }))
      ));
      const hits = [];
      for (const { person, rows } of results) {
        const name = persons.find((x) => x.entity_id === person)?.name || person;
        for (const row of rows) {
          hits.push({
            entity_id: person,
            name,
            chore_name: row.chore_name,
            chore_icon: row.chore_icon,
            minutes_ago: row.minutes_ago,
          });
        }
      }
      if (hits.length === 0) {
        await submit();
      } else {
        setRecentHits(hits);
        setStep(STEP_CONFIRM_DUPES);
      }
    } catch {
      // Defensive — Promise.all above already swallows individual failures.
      await submit();
    }
  };

  const submit = async () => {
    setStep(STEP_SUBMITTING);
    const calls = [];
    const suppressFollowup = scanners.length > 0;
    for (const p of shoppers) {
      calls.push({
        role: 'shopping',
        person: p,
        promise: axios.post(`${choresApi}/shopping-hook/complete`, {
          chore_id: shoppingChoreId,
          person: p,
          suppress_followup: suppressFollowup,
          notes: `Shopping session via Stock (${scanCount} scans)`,
        }),
      });
    }
    for (const p of scanners) {
      calls.push({
        role: 'scanning',
        person: p,
        promise: axios.post(`${choresApi}/shopping-hook/complete`, {
          chore_id: scanChoreId,
          person: p,
          suppress_followup: false,
          notes: `Shopping session via Stock (${scanCount} scans)`,
        }),
      });
    }

    if (calls.length === 0) {
      onClose?.();
      return;
    }

    const results = await Promise.allSettled(calls.map((c) => c.promise));
    const failures = [];
    results.forEach((r, i) => {
      if (r.status === 'rejected') failures.push(calls[i]);
    });

    if (failures.length === 0) {
      const parts = [];
      if (shoppers.length) parts.push(`${shoppers.length} shopper(s)`);
      if (scanners.length) parts.push(`${scanners.length} scanner(s)`);
      onToast?.(
        `Credited ${parts.join(', ')}. Level-ups will appear in Chores.`,
        'success',
      );
    } else if (failures.length === results.length) {
      onToast?.(
        "Couldn't reach Chores — scans saved, but XP wasn't credited.",
        'error',
      );
    } else {
      const failedRoles = failures.map((f) => `${f.role}:${f.person}`).join(', ');
      onToast?.(
        `Some attributions failed (${failedRoles}).`,
        'error',
      );
    }
    onClose?.();
  };

  if (step === STEP_LOADING_CONFIG || step === STEP_CHECKING || step === STEP_SUBMITTING) {
    const msg = step === STEP_LOADING_CONFIG
      ? 'Loading…'
      : step === STEP_CHECKING
      ? 'Checking…'
      : 'Crediting…';
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-gray-800 text-white rounded-2xl px-6 py-5">
          {msg}
        </div>
      </div>
    );
  }

  if (step === STEP_CONFIRM_DUPES) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-gray-800 text-white rounded-2xl px-5 py-5 max-w-sm w-full">
          <h3 className="text-lg font-semibold">Already credited recently</h3>
          <p className="text-sm text-gray-300 mt-2">
            These people were already credited for shopping or scanning in
            the last hour. Continue anyway?
          </p>
          <ul className="mt-3 space-y-1 max-h-72 overflow-y-auto text-sm">
            {recentHits.map((h, i) => (
              <li key={`${h.entity_id}-${i}`} className="flex items-center gap-2">
                <span aria-hidden="true">{h.chore_icon || '🧾'}</span>
                <span className="flex-1">
                  <span className="font-medium">{h.name}</span>
                  <span className="text-gray-400"> — {h.chore_name}</span>
                </span>
                {h.minutes_ago != null && (
                  <span className="text-xs text-gray-400 whitespace-nowrap">
                    {h.minutes_ago} min ago
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              className="w-full py-3 rounded-xl bg-brand-cobalt hover:bg-brand-cobalt-400 font-semibold"
              onClick={() => submit()}
            >
              Yes, continue
            </button>
            <button
              type="button"
              className="w-full py-2 rounded-xl bg-gray-700 hover:bg-gray-600"
              onClick={() => { setRecentHits([]); setStep(STEP_SCANNERS); }}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === STEP_NOT_CONFIGURED) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-gray-800 text-white rounded-2xl px-6 py-5 max-w-sm w-full">
          <h3 className="text-lg font-semibold">Chore mapping not configured</h3>
          <p className="text-sm text-gray-300 mt-2">
            Open the Chores add-on → Settings → Cross-app integrations and
            pick a shopping chore and a scan/unpack chore. Then come back
            and finish a shopping session again.
          </p>
          <button
            type="button"
            className="mt-4 w-full py-2 rounded-lg bg-brand-cobalt hover:bg-brand-cobalt-400 font-semibold"
            onClick={onClose}
          >
            OK
          </button>
        </div>
      </div>
    );
  }

  // STEP_SHOPPERS or STEP_SCANNERS
  const isShoppers = step === STEP_SHOPPERS;
  const picks = isShoppers ? shoppers : scanners;
  const setPicks = isShoppers ? setShoppers : setScanners;
  const title = isShoppers ? 'Who did the shopping?' : 'Who did the scanning?';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-gray-800 text-white rounded-2xl px-5 py-5 max-w-sm w-full">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-xs text-gray-400 mt-1">
          {scanCount} item{scanCount === 1 ? '' : 's'} scanned this session.
        </p>
        <ul className="mt-4 space-y-2 max-h-72 overflow-y-auto">
          {persons.map((p) => {
            const picked = picks.includes(p.entity_id);
            return (
              <li key={p.entity_id}>
                <button
                  type="button"
                  onClick={() => togglePick(picks, setPicks, p.entity_id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl border transition-colors ${
                    picked
                      ? 'bg-brand-cobalt/20 border-brand-cobalt'
                      : 'bg-gray-700/60 border-gray-700 hover:bg-gray-700'
                  }`}
                >
                  {p.avatar_url
                    ? <img src={p.avatar_url} alt="" className="w-8 h-8 rounded-full" />
                    : <span className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center">👤</span>}
                  <span className="flex-1 text-left">{p.name}</span>
                  {picked && <span aria-hidden="true">✓</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            className="w-full py-3 rounded-xl bg-brand-cobalt hover:bg-brand-cobalt-400 font-semibold disabled:opacity-50"
            onClick={() => {
              if (isShoppers) {
                setStep(STEP_SCANNERS);
              } else {
                checkAndSubmit();
              }
            }}
          >
            {isShoppers ? 'Next' : 'Done'}
          </button>
          <button
            type="button"
            className="w-full py-2 rounded-xl bg-gray-700 hover:bg-gray-600"
            onClick={() => {
              setPicks([]);
              if (isShoppers) {
                setStep(STEP_SCANNERS);
              } else {
                checkAndSubmit();
              }
            }}
          >
            Skip this role
          </button>
          <button
            type="button"
            className="w-full py-2 rounded-xl text-gray-400 hover:text-white text-sm"
            onClick={() => {
              if (isShoppers) {
                onClose?.();
              } else {
                setStep(STEP_SHOPPERS);
              }
            }}
          >
            {isShoppers ? 'Cancel' : 'Back'}
          </button>
        </div>
      </div>
    </div>
  );
}
