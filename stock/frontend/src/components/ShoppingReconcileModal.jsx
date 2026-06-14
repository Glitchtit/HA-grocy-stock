import { useState } from 'react';
import axios from 'axios';

// ---------------------------------------------------------------------------
// Shopping Reconcile Modal
//
// Shown at the end of a shopping scan session when the AI proposes that some
// item bought this trip is a variation (different brand / pack size, same
// product type) of something still on the list — e.g. you listed one Gouda but
// bought another brand, or any Béarnaise for a listed Béarnaise.
//
// Each proposal is "List item ← Bought item", pre-checked. Confirming POSTs the
// checked matches to /shopping-list/reconcile/apply, which decrements those
// list rows. Skipping applies nothing. Either way onDone() runs so the caller
// can refresh the list and continue into the attribution flow.
// ---------------------------------------------------------------------------

export default function ShoppingReconcileModal({ apiBase, proposals, onDone, onToast }) {
  // Default every proposal checked, keyed by shopping_row_id.
  const [checked, setChecked] = useState(() =>
    new Set(proposals.map((p) => p.shopping_row_id)),
  );
  const [submitting, setSubmitting] = useState(false);

  const toggle = (rowId) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const confirm = async () => {
    const matches = proposals.filter((p) => checked.has(p.shopping_row_id));
    if (matches.length === 0) {
      onDone?.();
      return;
    }
    setSubmitting(true);
    try {
      const resp = await axios.post(`${apiBase}/shopping-list/reconcile/apply`, { matches });
      const n = resp.data?.applied?.length ?? matches.length;
      onToast?.(`Ticked off ${n} item${n === 1 ? '' : 's'} bought as another brand.`, 'success');
    } catch (err) {
      onToast?.(
        err?.response?.data?.detail ?? "Couldn't update the list — items left as-is.",
        'error',
      );
    } finally {
      setSubmitting(false);
      onDone?.();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-gray-800 text-white rounded-2xl px-5 py-5 max-w-sm w-full">
        <h3 className="text-lg font-semibold">Eri merkki — täytetäänkö lista?</h3>
        <p className="text-sm text-gray-300 mt-1">
          Ostit tuotteita, jotka näyttävät olevan eri merkki samasta listalla
          olevasta tuotteesta. Merkitäänkö ne tehdyiksi?
        </p>
        <ul className="mt-4 space-y-2 max-h-72 overflow-y-auto">
          {proposals.map((p) => {
            const on = checked.has(p.shopping_row_id);
            return (
              <li key={p.shopping_row_id}>
                <button
                  type="button"
                  onClick={() => toggle(p.shopping_row_id)}
                  className={`w-full flex items-start gap-3 px-3 py-2 rounded-xl border text-left transition-colors ${
                    on
                      ? 'bg-brand-cobalt/20 border-brand-cobalt'
                      : 'bg-gray-700/60 border-gray-700 hover:bg-gray-700'
                  }`}
                >
                  <span
                    className={`mt-0.5 w-5 h-5 flex-shrink-0 rounded border flex items-center justify-center text-xs ${
                      on ? 'bg-brand-cobalt border-brand-cobalt text-white' : 'border-gray-500 text-transparent'
                    }`}
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{p.shopping_name}</span>
                    <span className="block text-xs text-gray-400 truncate">
                      ← {p.bought_name}
                      {p.amount && p.amount !== 1 ? ` ×${p.amount % 1 === 0 ? p.amount : p.amount.toFixed(1)}` : ''}
                    </span>
                  </span>
                  {p.confidence === 'medium' && (
                    <span className="text-[10px] uppercase tracking-wide text-amber-300/80 whitespace-nowrap mt-0.5">
                       epävarma
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-brand-cobalt hover:bg-brand-cobalt-400 font-semibold disabled:opacity-50"
            onClick={confirm}
          >
            {submitting ? 'Merkitään…' : 'Merkitse valitut tehdyiksi'}
          </button>
          <button
            type="button"
            disabled={submitting}
            className="w-full py-2 rounded-xl bg-gray-700 hover:bg-gray-600 disabled:opacity-50"
            onClick={() => onDone?.()}
          >
            Ohita
          </button>
        </div>
      </div>
    </div>
  );
}
