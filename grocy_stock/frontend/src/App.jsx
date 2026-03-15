import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

// ---------------------------------------------------------------------------
// Ingress-path awareness
// nginx injects the X-Ingress-Path header value into this meta tag at runtime,
// so every API call and asset URL works whether the app is served directly or
// through the HA ingress proxy.
// ---------------------------------------------------------------------------
const INGRESS_PATH =
  document.querySelector('meta[name="ingress-path"]')?.content ?? '';

const API_BASE = `${INGRESS_PATH}/api/grocy`;

// ---------------------------------------------------------------------------
// Helper – encode a Grocy picture filename for the files API (Base64)
// ---------------------------------------------------------------------------
function pictureUrl(filename) {
  if (!filename) return null;
  try {
    return `${API_BASE}/files/productpictures/${btoa(filename)}?force_serve_as=picture&best_fit_width=100`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ProductThumbnail
// Shows the product image; falls back to a neutral placeholder so every row
// keeps the same dimensions.
// ---------------------------------------------------------------------------
function ProductThumbnail({ imageUrl, name }) {
  const [failed, setFailed] = useState(false);

  if (!imageUrl || failed) {
    return (
      <div
        className="w-12 h-12 flex-shrink-0 rounded-lg bg-gray-700 flex items-center justify-center text-2xl select-none"
        aria-hidden="true"
      >
        🥫
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={name}
      className="w-12 h-12 flex-shrink-0 rounded-lg object-cover"
      onError={() => setFailed(true)}
    />
  );
}

// ---------------------------------------------------------------------------
// ProductGroup  (collapsible accordion)
// ---------------------------------------------------------------------------
function ProductGroup({ group, items, onConsume }) {
  const [open, setOpen] = useState(true);

  const totalQty = items.reduce((sum, i) => sum + i.amount, 0);
  const displayQty = totalQty % 1 === 0 ? totalQty : totalQty.toFixed(2);

  return (
    <div className="bg-gray-800 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-emerald-900/40 hover:bg-emerald-900/60 transition-colors text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-emerald-400 truncate">
            {group.name}
          </span>
          <span className="flex-shrink-0 bg-emerald-900/60 text-emerald-300 text-xs font-medium px-2 py-0.5 rounded-full">
            {displayQty}
          </span>
        </div>
        <span className="flex-shrink-0 text-emerald-500 ml-2" aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {/* Body */}
      {open && (
        <ul>
          {items.map((item) => (
            <li
              key={item.product_id}
              className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-700 last:border-b-0 hover:bg-gray-700/50 transition-colors"
            >
              <ProductThumbnail
                imageUrl={pictureUrl(item.product?.picture_file_name)}
                name={item.product?.name}
              />

              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-100 truncate">
                  {item.product?.name}
                </p>
                <p className="text-sm text-gray-400">
                  {item.amount % 1 === 0
                    ? item.amount
                    : item.amount.toFixed(2)}{' '}
                  in stock
                </p>
              </div>

              <button
                onClick={() => onConsume(item.product_id)}
                className="flex-shrink-0 w-10 h-10 bg-red-500 hover:bg-red-600 active:bg-red-700 text-white font-bold text-sm rounded-lg flex items-center justify-center transition-colors shadow-sm"
                aria-label={`Consume one ${item.product?.name ?? 'item'}`}
              >
                −1
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------------------
function Toasts({ toasts }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`px-4 py-3 rounded-lg shadow-lg text-white text-sm max-w-xs pointer-events-auto ${
            t.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'
          }`}
          role="alert"
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  const [stockItems, setStockItems] = useState([]);
  const [productGroups, setProductGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toasts, setToasts] = useState([]);

  // ---- Toast helper --------------------------------------------------------
  const addToast = useCallback((message, type = 'error') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      4000,
    );
  }, []);

  // ---- Initial data fetch --------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [stockRes, groupsRes] = await Promise.all([
          axios.get(`${API_BASE}/stock`),
          axios.get(`${API_BASE}/objects/product_groups`),
        ]);

        if (cancelled) return;

        const items = (stockRes.data ?? [])
          .filter((item) => parseFloat(item.amount) > 0)
          .map((item) => ({ ...item, amount: parseFloat(item.amount) }));

        setStockItems(items);
        setProductGroups(groupsRes.data ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(
            err?.response?.data?.detail_message ??
              err?.message ??
              'Failed to load stock data.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // ---- Consume (optimistic UI update) --------------------------------------
  const handleConsume = useCallback(
    async (productId) => {
      // Snapshot current state for rollback
      const snapshot = stockItems.map((i) => ({ ...i }));

      // Immediate optimistic decrement; remove item if it hits zero
      setStockItems((prev) =>
        prev
          .map((item) =>
            item.product_id === productId
              ? { ...item, amount: item.amount - 1 }
              : item,
          )
          .filter((item) => item.amount > 0),
      );

      try {
        await axios.post(
          `${API_BASE}/stock/products/${productId}/consume`,
          { amount: 1, transaction_type: 'consume', spoiled: false },
        );
      } catch (err) {
        // Rollback on failure
        setStockItems(snapshot);
        addToast(
          err?.response?.data?.detail_message ??
            'Failed to consume item. Please try again.',
          'error',
        );
      }
    },
    [stockItems, addToast],
  );

  // ---- Build group map & sorted group IDs ----------------------------------
  const groupMap = Object.fromEntries(productGroups.map((g) => [g.id, g]));

  const grouped = {};
  for (const item of stockItems) {
    const gid = item.product?.product_group_id ?? '__ungrouped__';
    (grouped[gid] ??= []).push(item);
  }

  const sortedGroupIds = [
    ...Object.keys(grouped)
      .filter((id) => id !== '__ungrouped__')
      .sort((a, b) =>
        (groupMap[a]?.name ?? '').localeCompare(groupMap[b]?.name ?? ''),
      ),
    ...(grouped.__ungrouped__ ? ['__ungrouped__'] : []),
  ];

  // ---- Render --------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4" />
          <p className="text-gray-400">Loading stock…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 px-4">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-4" aria-hidden="true">⚠️</div>
          <h2 className="text-xl font-semibold text-gray-100 mb-2">
            Connection Error
          </h2>
          <p className="text-gray-400 mb-4">{error}</p>
          <p className="text-sm text-gray-500">
            Check your Grocy URL and API key in the add-on settings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 bg-gray-800 text-white px-4 py-4 shadow-md border-b border-gray-700">
        <h1 className="text-xl font-bold tracking-tight">🥫 Grocy Stock</h1>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <main className="max-w-2xl mx-auto py-4 px-2 sm:px-4 space-y-2">
        {stockItems.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <p className="text-5xl mb-3" aria-hidden="true">📦</p>
            <p className="text-lg">No items currently in stock.</p>
          </div>
        ) : (
          sortedGroupIds.map((gid) => {
            const group =
              gid === '__ungrouped__'
                ? { id: '__ungrouped__', name: 'Ungrouped' }
                : groupMap[gid] ?? { id: gid, name: 'Unknown Group' };
            return (
              <ProductGroup
                key={gid}
                group={group}
                items={grouped[gid]}
                onConsume={handleConsume}
              />
            );
          })
        )}
      </main>

      {/* ── Toasts ─────────────────────────────────────────────────────── */}
      <Toasts toasts={toasts} />
    </div>
  );
}
