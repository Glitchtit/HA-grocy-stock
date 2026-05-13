import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';
import { Html5Qrcode } from 'html5-qrcode';
import ShoppingAttributionModal from './components/ShoppingAttributionModal';

// ---------------------------------------------------------------------------
// Ingress-path awareness
// nginx injects the X-Ingress-Path header value into this meta tag at runtime,
// so every API call and asset URL works whether the app is served directly or
// through the HA ingress proxy.
// ---------------------------------------------------------------------------
const INGRESS_PATH =
  document.querySelector('meta[name="ingress-path"]')?.content ?? '';

const API_BASE = `${INGRESS_PATH}/api/storage`;
const SCRAPER_API = `${INGRESS_PATH}/api/scraper`;
const CHORES_API = `${INGRESS_PATH}/api/chores`;

// ---------------------------------------------------------------------------
// Helper – build a product image URL for the Storage files API
// ---------------------------------------------------------------------------
function pictureUrl(filename) {
  if (!filename) return null;
  return `${API_BASE}/files/products/${encodeURIComponent(filename)}`;
}

// Helper – build a compressed thumbnail URL (128×128 JPEG served by Storage)
function thumbUrl(filename) {
  if (!filename) return null;
  return `${API_BASE}/files/products/thumb/${encodeURIComponent(filename)}`;
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
// Helper – format the "X in stock (Y opened)" label
// ---------------------------------------------------------------------------
function stockLabel(amount, amountOpened) {
  const qty = amount % 1 === 0 ? amount : amount.toFixed(2);
  const opened = Math.floor(amountOpened || 0);
  if (opened > 0) return `${qty} in stock (${opened} opened)`;
  return `${qty} in stock`;
}

// ---------------------------------------------------------------------------
// Finnish grocery-store aisle ordering
// Maps a case-insensitive substring of a product-group name to an aisle index
// (sort key) and a human-readable Finnish label used as the section header.
// Unknown groups (and items without a group) fall into "Muut" at the bottom.
// ---------------------------------------------------------------------------
const FI_AISLE_ORDER = [
  ['hedelm',     1,  'Hedelmät & vihannekset'],
  ['vihannes',   1,  'Hedelmät & vihannekset'],
  ['kasvi',      1,  'Hedelmät & vihannekset'],
  ['leip',       2,  'Leipä & leivonnaiset'],
  ['leivonn',    2,  'Leipä & leivonnaiset'],
  ['maito',      3,  'Maitotuotteet'],
  ['juusto',     3,  'Maitotuotteet'],
  ['jogurt',     3,  'Maitotuotteet'],
  ['muna',       3,  'Maitotuotteet'],
  ['liha',       4,  'Liha & kala'],
  ['kala',       4,  'Liha & kala'],
  ['einek',      5,  'Eineet'],
  ['valmis',     5,  'Eineet'],
  ['pakast',     6,  'Pakaste'],
  ['kuiva',      7,  'Kuivamuonat'],
  ['mauste',     7,  'Kuivamuonat'],
  ['säilyk',     7,  'Kuivamuonat'],
  ['sailyk',     7,  'Kuivamuonat'],
  ['makeis',     8,  'Makeiset & naposteltavat'],
  ['snack',      8,  'Makeiset & naposteltavat'],
  ['naposteltav',8,  'Makeiset & naposteltavat'],
  ['juoma',      9,  'Juomat'],
  ['kahvi',      9,  'Juomat'],
  ['tee',        9,  'Juomat'],
  ['olu',        10, 'Alkoholi'],
  ['viini',      10, 'Alkoholi'],
  ['pesu',       11, 'Pesuaineet & kodinhoito'],
  ['siivous',    11, 'Pesuaineet & kodinhoito'],
  ['hygien',     12, 'Hygienia & kosmetiikka'],
  ['kosmetiik',  12, 'Hygienia & kosmetiikka'],
  ['vauva',      13, 'Vauva & lemmikki'],
  ['lemmik',     13, 'Vauva & lemmikki'],
];
const OTHER_AISLE = { idx: 99, label: 'Muut' };

function aisleFor(groupName) {
  const n = (groupName || '').toLowerCase();
  if (!n) return OTHER_AISLE;
  for (const [key, idx, label] of FI_AISLE_ORDER) {
    if (n.includes(key)) return { idx, label };
  }
  return OTHER_AISLE;
}

// ---------------------------------------------------------------------------
// Lightweight matcher used by the shopping-list quick-add bar.
// Returns a positive score for a substring match (higher = better) and -1 for
// no match. Letters in the query must appear contiguously in the name — no
// subsequence matching, so e.g. "serto" never matches "sokeriton".
// ---------------------------------------------------------------------------
function fuzzyScore(query, name) {
  if (!query) return 0;
  const q = query.toLowerCase().trim();
  const n = (name || '').toLowerCase();
  if (!q || !n) return -1;
  if (n === q) return 1000;
  if (n.startsWith(q)) return 800 - n.length;
  // word-prefix bonus: matches the start of any word
  const words = n.split(/[\s\-_/]+/);
  if (words.some((w) => w.startsWith(q))) return 700 - n.length;
  if (n.includes(q)) return 500 - n.length;
  return -1;
}

// Sentinel product name used to back free-text "note" entries that have no
// real product. Created lazily on first use.
const NOTE_SENTINEL_NAME = 'Muistilappu';

// ---------------------------------------------------------------------------
// ProductDetailOverlay
// Full-screen overlay with product details and action buttons.
// ---------------------------------------------------------------------------
function ProductDetailOverlay({
  item,
  parentProduct,
  onClose,
  onToggleKeep,
  onAdd,
  onConsume,
  onConsumeAll,
  onOpen,
  onSpoil,
  onAddToShopping,
}) {
  // Prevent phantom synthetic clicks (browser fires a synthetic click ~300ms
  // after touchend at the SAME coordinates). Without a guard the click lands on
  // the freshly-mounted overlay and either closes it (backdrop) or presses
  // whatever button happens to sit at those coordinates.
  // Solution: disable ALL pointer events on the overlay for 350ms, then enable.
  // Destructive buttons also stay disabled (semantic/a11y) via the same flag.
  const [interactive, setInteractive] = useState(false);
  useEffect(() => {
    if (!item) return;
    setInteractive(false);
    const id = setTimeout(() => setInteractive(true), 500);
    return () => clearTimeout(id);
  }, [item]);

  if (!item) return null;

  const product = item.product;
  const name = product?.name ?? 'Unknown Product';
  const imgUrl = pictureUrl(product?.picture_filename);
  const minStock = parseFloat(product?.min_stock_amount ?? 0);
  const isKept = minStock >= 1;
  const parentMinStock = parseFloat(parentProduct?.min_stock_amount ?? 0);
  const parentKept = !isKept && parentMinStock >= 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm overlay-enter"
      style={{ pointerEvents: interactive ? 'auto' : 'none' }}
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden overlay-card-enter"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <div className="flex justify-end p-2">
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 text-2xl leading-none px-2"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Product image */}
        <div className="flex justify-center px-6 pb-4">
          <OverlayImage imageUrl={imgUrl} name={name} />
        </div>

        {/* Product info */}
        <div className="px-6 pb-4 text-center">
          <h2 className="text-xl font-bold text-gray-100">{name}</h2>
          <p className="text-gray-400 mt-1">
            {stockLabel(item.amount, item.amount_opened)}
          </p>
        </div>

        {/* Action buttons */}
        <div className="px-6 pb-6 space-y-3">
          {/* Row 1: +1 | -1 (side-by-side) */}
          <div className="flex gap-2">
            <button
              onClick={onAdd}
              className="flex-1 py-3 rounded-xl font-bold text-white text-base bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 transition-colors disabled:opacity-40"
              disabled={!interactive}
            >
              +1
            </button>
            <button
              onClick={onConsume}
              className="flex-1 py-3 rounded-xl font-bold text-white text-base bg-red-500 hover:bg-red-600 active:bg-red-700 transition-colors disabled:opacity-40"
              disabled={item.amount <= 0 || !interactive}
            >
              −1
            </button>
          </div>

          {/* Row 2: Keep in stock | Add to Shopping */}
          <div className="flex gap-2">
            <button
              onClick={onToggleKeep}
              disabled={!interactive}
              className={`flex-1 py-3 rounded-xl font-semibold text-white text-sm transition-colors disabled:opacity-40 ${
                isKept
                  ? 'bg-red-500 hover:bg-red-600 active:bg-red-700'
                  : parentKept
                    ? 'bg-amber-500 hover:bg-amber-600 active:bg-amber-700'
                    : 'bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700'
              }`}
            >
              {isKept
                ? 'Do not keep'
                : parentKept
                  ? `${parentProduct.name} is kept in stock`
                  : 'Keep in stock'}
            </button>
            <button
              onClick={onAddToShopping}
              disabled={!interactive || !onAddToShopping}
              className="flex-1 py-3 rounded-xl font-semibold text-white text-sm bg-brand-cobalt hover:bg-brand-cobalt-400 active:bg-brand-cobalt-600 transition-colors disabled:opacity-40"
            >
              🛒 Add to Shopping
            </button>
          </div>

          {/* Consume all */}
          <button
            onClick={onConsumeAll}
            className="w-full py-3 rounded-xl font-semibold text-white text-sm bg-red-500 hover:bg-red-600 active:bg-red-700 transition-colors disabled:opacity-40"
            disabled={item.amount <= 0 || !interactive}
          >
            Consume all
          </button>

          {/* Open one */}
          <button
            onClick={onOpen}
            className="w-full py-3 rounded-xl font-semibold text-white text-sm bg-amber-500 hover:bg-amber-600 active:bg-amber-700 transition-colors disabled:opacity-40"
            disabled={item.amount <= 0 || !interactive}
          >
            Open 1
          </button>

          {/* Spoiled — consume 1 and log as spoil in history */}
          <button
            onClick={onSpoil}
            className="w-full py-3 rounded-xl font-semibold text-white text-sm bg-rose-700 hover:bg-rose-800 active:bg-rose-900 transition-colors disabled:opacity-40"
            disabled={item.amount <= 0 || !interactive}
          >
            Spoiled
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KeepInStockDialog
// Shown when the user presses "Keep in stock" on a product that has a parent.
// Offers two choices: keep the parent product or detach and keep this one.
// ---------------------------------------------------------------------------
function KeepInStockDialog({ mode, productName, parentName, onKeepParent, onKeepThis, onStopKeepingParent, onClose }) {
  const isParentKept = mode === 'parent_kept';
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm overlay-enter"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-xs mx-4 p-6 overlay-card-enter"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-gray-100 text-center mb-2">
          {isParentKept ? 'Parent is kept in stock' : 'Keep in stock'}
        </h3>
        <p className="text-gray-400 text-sm text-center mb-5">
          {isParentKept ? (
            <>
              <span className="font-semibold text-gray-200">{parentName}</span>{' '}
              is already kept in stock for{' '}
              <span className="font-semibold text-gray-200">{productName}</span>.
            </>
          ) : (
            <>
              <span className="font-semibold text-gray-200">{productName}</span> is
              grouped under{' '}
              <span className="font-semibold text-gray-200">{parentName}</span>.
              Which should be kept in stock?
            </>
          )}
        </p>
        <div className="space-y-2">
          {isParentKept ? (
            <>
              <button
                onClick={onStopKeepingParent}
                className="w-full py-3 rounded-xl font-semibold text-white text-sm bg-red-500 hover:bg-red-600 active:bg-red-700 transition-colors"
              >
                Stop keeping "{parentName}"
              </button>
              <button
                onClick={onKeepThis}
                className="w-full py-3 rounded-xl font-semibold text-white text-sm bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 transition-colors"
              >
                Keep "{productName}" as well
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onKeepParent}
                className="w-full py-3 rounded-xl font-semibold text-white text-sm bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 transition-colors"
              >
                Keep "{parentName}"
              </button>
              <button
                onClick={onKeepThis}
                className="w-full py-3 rounded-xl font-semibold text-white text-sm bg-amber-500 hover:bg-amber-600 active:bg-amber-700 transition-colors"
              >
                Keep only "{productName}"
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="w-full py-2 rounded-xl font-semibold text-gray-400 text-sm hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function OverlayImage({ imageUrl, name }) {
  const [failed, setFailed] = useState(false);

  if (!imageUrl || failed) {
    return (
      <div
        className="w-40 h-40 rounded-xl bg-gray-700 flex items-center justify-center text-6xl select-none"
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
      className="w-40 h-40 rounded-xl object-cover"
      onError={() => setFailed(true)}
    />
  );
}

// ---------------------------------------------------------------------------
// SwipeableProductRow
// Touch-gesture-enabled product row. Supports:
//   • Tap → opens detail overlay
//   • Swipe right → add one (+1)
//   • Swipe left  → consume one (−1)
//   • Long press (400 ms) → directional hints, then:
//       • Drag left/right → consume/add
//       • Drag down → mark as "opened"
// ---------------------------------------------------------------------------
function SwipeableProductRow({ item, onConsume, onAdd, onOpen, onItemClick }) {
  const rowRef = useRef(null);
  const addBgRef = useRef(null);
  const consumeBgRef = useRef(null);
  const openBgRef = useRef(null);
  const lpTimerRef = useRef(null);
  const lastTouchRef = useRef(0);

  const cbRef = useRef({ onConsume, onAdd, onOpen, onItemClick });
  cbRef.current = { onConsume, onAdd, onOpen, onItemClick };

  const pidRef = useRef(item.product_id);
  pidRef.current = item.product_id;

  const touchState = useRef({
    startX: 0, startY: 0, startTime: 0,
    phase: 'idle', moved: false,
  });

  const [longPressActive, setLongPressActive] = useState(false);
  const [animReturn, setAnimReturn] = useState(false);

  const LONG_PRESS_MS = 400;
  const SWIPE_THRESHOLD = 80;
  const DIR_LOCK = 10;

  const resetBg = useCallback(() => {
    [addBgRef, consumeBgRef, openBgRef].forEach((r) => {
      if (r.current) r.current.style.opacity = '0';
    });
  }, []);

  const springBack = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    el.style.transition = 'transform 0.25s cubic-bezier(.25,.46,.45,.94)';
    el.style.transform = '';
    resetBg();
    setTimeout(() => { if (el) el.style.transition = ''; }, 260);
  }, [resetBg]);

  const animateOut = useCallback(
    (direction, callback) => {
      touchState.current.phase = 'animating';
      const el = rowRef.current;
      if (!el) { callback(); return; }
      const targets = {
        left: 'translateX(-110%)',
        right: 'translateX(110%)',
        down: 'translateY(200%)',
      };
      el.style.transition = 'transform 0.25s ease-in, opacity 0.2s ease-in';
      el.style.transform = targets[direction];
      el.style.opacity = '0';
      setTimeout(() => {
        callback();
        if (el) {
          el.style.transition = '';
          el.style.transform = '';
          el.style.opacity = '';
        }
        resetBg();
        setLongPressActive(false);
        setAnimReturn(true);
        setTimeout(() => {
          setAnimReturn(false);
          touchState.current.phase = 'idle';
        }, 300);
      }, 280);
    },
    [resetBg],
  );

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;

    const onStart = (e) => {
      if (touchState.current.phase === 'animating') return;
      const t = e.touches[0];
      touchState.current = {
        startX: t.clientX,
        startY: t.clientY,
        startTime: Date.now(),
        phase: 'idle',
        moved: false,
      };
      clearTimeout(lpTimerRef.current);
      lpTimerRef.current = setTimeout(() => {
        if (touchState.current.phase === 'idle') {
          touchState.current.phase = 'long-press';
          setLongPressActive(true);
          if (rowRef.current) rowRef.current.style.transform = 'scale(1.03)';
          try { navigator.vibrate?.(50); } catch {}
        }
      }, LONG_PRESS_MS);
    };

    const onMove = (e) => {
      const s = touchState.current;
      s.moved = true;
      if (s.phase === 'scroll' || s.phase === 'animating') return;

      const tc = e.touches[0];
      const dx = tc.clientX - s.startX;
      const dy = tc.clientY - s.startY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (s.phase === 'idle') {
        if (absDx < DIR_LOCK && absDy < DIR_LOCK) return;
        clearTimeout(lpTimerRef.current);
        if (absDx > absDy) {
          s.phase = 'swiping';
          e.preventDefault();
        } else {
          s.phase = 'scroll';
          return;
        }
      }

      if (s.phase === 'swiping') {
        e.preventDefault();
        if (rowRef.current)
          rowRef.current.style.transform = `translateX(${dx}px)`;
        const progress = Math.min(absDx / SWIPE_THRESHOLD, 1);
        if (dx > 0) {
          if (addBgRef.current)
            addBgRef.current.style.opacity = String(0.3 + 0.7 * progress);
          if (consumeBgRef.current)
            consumeBgRef.current.style.opacity = '0';
        } else {
          if (consumeBgRef.current)
            consumeBgRef.current.style.opacity = String(0.3 + 0.7 * progress);
          if (addBgRef.current)
            addBgRef.current.style.opacity = '0';
        }
        if (openBgRef.current) openBgRef.current.style.opacity = '0';
      }

      if (s.phase === 'long-press' || s.phase === 'lp-drag') {
        e.preventDefault();
        s.phase = 'lp-drag';
        const clampedDy = Math.max(0, dy);
        if (rowRef.current)
          rowRef.current.style.transform = `translate(${dx}px, ${clampedDy}px) scale(1.03)`;

        if (absDx > clampedDy) {
          const progress = Math.min(absDx / SWIPE_THRESHOLD, 1);
          if (dx > 0) {
            if (addBgRef.current)
              addBgRef.current.style.opacity = String(0.3 + 0.7 * progress);
            if (consumeBgRef.current)
              consumeBgRef.current.style.opacity = '0';
          } else {
            if (consumeBgRef.current)
              consumeBgRef.current.style.opacity = String(0.3 + 0.7 * progress);
            if (addBgRef.current)
              addBgRef.current.style.opacity = '0';
          }
          if (openBgRef.current) openBgRef.current.style.opacity = '0';
        } else if (clampedDy > 0) {
          const progress = Math.min(clampedDy / SWIPE_THRESHOLD, 1);
          if (openBgRef.current)
            openBgRef.current.style.opacity = String(0.3 + 0.7 * progress);
          if (addBgRef.current) addBgRef.current.style.opacity = '0';
          if (consumeBgRef.current) consumeBgRef.current.style.opacity = '0';
        }
      }
    };

    const onEnd = (e) => {
      const s = touchState.current;
      clearTimeout(lpTimerRef.current);
      if (s.phase === 'animating') return;

      const tc = e.changedTouches[0];
      const dx = tc.clientX - s.startX;
      const dy = tc.clientY - s.startY;
      const elapsed = Date.now() - s.startTime;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const pid = pidRef.current;

      if (s.phase === 'idle') {
        // Bounding-rect check tolerates natural finger drift at the bottom of
        // the screen (15-25 px).  The dist < 30 guard prevents slow scrolls
        // (where each individual move < DIR_LOCK so phase stays 'idle') from
        // being misclassified as taps.
        if (dist < 30) {
          const rect = el.getBoundingClientRect();
          if (
            tc.clientX >= rect.left &&
            tc.clientX <= rect.right &&
            tc.clientY >= rect.top &&
            tc.clientY <= rect.bottom
          ) {
            lastTouchRef.current = Date.now();
            cbRef.current.onItemClick(pid);
          }
        }
        setLongPressActive(false);
        s.phase = 'idle';
        return;
      }

      if (s.phase === 'swiping') {
        if (Math.abs(dx) >= SWIPE_THRESHOLD) {
          const dir = dx > 0 ? 'right' : 'left';
          const cb = dx > 0
            ? () => cbRef.current.onAdd(pid)
            : () => cbRef.current.onConsume(pid);
          animateOut(dir, cb);
        } else {
          springBack();
          s.phase = 'idle';
        }
        return;
      }

      if (s.phase === 'long-press') {
        if (rowRef.current) {
          rowRef.current.style.transition = 'transform 0.2s ease-out';
          rowRef.current.style.transform = '';
        }
        setTimeout(() => {
          if (rowRef.current) rowRef.current.style.transition = '';
        }, 220);
        setLongPressActive(false);
        s.phase = 'idle';
        return;
      }

      if (s.phase === 'lp-drag') {
        const absDx = Math.abs(dx);
        const posDy = Math.max(0, dy);
        // Small drift during long-press → treat as tap (open detail overlay)
        if (dist < SWIPE_THRESHOLD) {
          springBack();
          setLongPressActive(false);
          s.phase = 'idle';
          lastTouchRef.current = Date.now();
          cbRef.current.onItemClick(pid);
          return;
        }
        if (absDx > posDy && absDx >= SWIPE_THRESHOLD) {
          const dir = dx > 0 ? 'right' : 'left';
          const cb = dx > 0
            ? () => cbRef.current.onAdd(pid)
            : () => cbRef.current.onConsume(pid);
          animateOut(dir, cb);
        } else if (posDy > absDx && posDy >= SWIPE_THRESHOLD) {
          animateOut('down', () => cbRef.current.onOpen(pid));
        } else {
          springBack();
          setLongPressActive(false);
          s.phase = 'idle';
        }
        return;
      }

      // Tap escape — the browser's overscroll/rubber-band bounce can add
      // 20-30 px of drift on a clean tap, pushing phase to 'scroll'.
      // Accept it as a tap only when total finger movement is small (< 30 px)
      // AND the finger lifted inside the row.  This prevents quick flick
      // scrolls (dist 50-200 px) from opening details.
      if (s.phase === 'scroll') {
        if (elapsed < 500 && dist < 30) {
          const rect = el.getBoundingClientRect();
          const endX = tc.clientX;
          const endY = tc.clientY;
          if (
            endX >= rect.left &&
            endX <= rect.right &&
            endY >= rect.top &&
            endY <= rect.bottom
          ) {
            lastTouchRef.current = Date.now();
            cbRef.current.onItemClick(pid);
          }
        }
        setLongPressActive(false);
        s.phase = 'idle';
        return;
      }

      setLongPressActive(false);
      s.phase = 'idle';
    };

    // touchcancel fires when the OS/WebView gesture recogniser steals the
    // touch (e.g. iOS home-indicator edge, Android nav-bar region).  It also
    // fires when the browser takes over for scrolling.  Only treat as a tap
    // if there was NO finger movement (no touchmove received) — that means
    // the OS stole a stationary tap, not a scroll.
    const onCancel = () => {
      const s = touchState.current;
      clearTimeout(lpTimerRef.current);
      if (s.phase === 'idle' && !s.moved) {
        const elapsed = Date.now() - s.startTime;
        if (elapsed < 500) {
          lastTouchRef.current = Date.now();
          cbRef.current.onItemClick(pidRef.current);
        }
      }
      setLongPressActive(false);
      s.phase = 'idle';
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onCancel, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
      clearTimeout(lpTimerRef.current);
    };
  }, [animateOut, springBack]);

  const name = item.product?.name ?? 'Unknown Product';

  return (
    <li className="relative overflow-hidden border-b border-gray-700 last:border-b-0">
      {/* +1 background (green, left-aligned) */}
      <div
        ref={addBgRef}
        className="absolute inset-0 bg-emerald-600 flex items-center pl-5 text-white font-bold text-lg select-none"
        style={{ opacity: 0 }}
        aria-hidden="true"
      >
        +1
      </div>
      {/* −1 background (red, right-aligned) */}
      <div
        ref={consumeBgRef}
        className="absolute inset-0 bg-red-600 flex items-center justify-end pr-5 text-white font-bold text-lg select-none"
        style={{ opacity: 0 }}
        aria-hidden="true"
      >
        −1
      </div>
      {/* Open background (amber, centered) */}
      <div
        ref={openBgRef}
        className="absolute inset-0 bg-amber-500 flex items-center justify-center text-white font-bold text-lg select-none"
        style={{ opacity: 0 }}
        aria-hidden="true"
      >
        📦 Open
      </div>

      {/* Sliding foreground row */}
      <div
        ref={rowRef}
        className={`relative flex items-center gap-3 px-4 py-2.5 bg-gray-800 select-none ${
          longPressActive
            ? 'shadow-2xl z-10 ring-2 ring-brand-orange rounded-lg'
            : ''
        } ${animReturn ? 'swipe-return' : ''}`}
        style={{ touchAction: 'manipulation' }}
        onClick={() => {
          if (Date.now() - lastTouchRef.current < 500) return;
          lastTouchRef.current = Date.now();
          cbRef.current.onItemClick(pidRef.current);
        }}
      >
        <ProductThumbnail
          imageUrl={thumbUrl(item.product?.picture_filename)}
          name={name}
        />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-100 truncate">{name}</p>
          <p className="text-sm text-gray-400">
            {stockLabel(item.amount, item.amount_opened)}
          </p>
        </div>

        {longPressActive && (
          <>
            <div className="absolute inset-0 flex items-center justify-between pointer-events-none px-1">
              <span className="text-[10px] font-bold text-red-300 bg-gray-900/80 px-1.5 py-0.5 rounded-full">
                ← −1
              </span>
              <span className="text-[10px] font-bold text-emerald-300 bg-gray-900/80 px-1.5 py-0.5 rounded-full">
                +1 →
              </span>
            </div>
            <div className="absolute left-1/2 -translate-x-1/2 bottom-1 pointer-events-none">
              <span className="text-[10px] font-bold text-amber-300 bg-gray-900/80 px-1.5 py-0.5 rounded-full">
                ↓ Open
              </span>
            </div>
          </>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// ProductGroup  (collapsible accordion)
// ---------------------------------------------------------------------------
function ProductGroup({ group, items, onConsume, onAdd, onOpen, onItemClick, forceOpen, forceKey, isFavorite, onToggleFavorite }) {
  const [open, setOpen] = useState(true);

  // Sync local state when parent triggers a bulk expand/collapse
  useEffect(() => {
    if (forceOpen !== undefined && forceOpen !== null) {
      setOpen(forceOpen);
    }
  }, [forceOpen, forceKey]);

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
          {onToggleFavorite && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleFavorite();
                }
              }}
              className={`flex-shrink-0 select-none cursor-pointer text-lg leading-none px-1 -mx-1 transition-colors ${
                isFavorite
                  ? 'text-amber-400 hover:text-amber-300'
                  : 'text-emerald-700 hover:text-amber-400'
              }`}
              aria-label={isFavorite ? 'Poista suosikeista' : 'Lisää suosikkeihin'}
              aria-pressed={isFavorite ? 'true' : 'false'}
              title={isFavorite ? 'Poista suosikeista' : 'Lisää suosikkeihin'}
            >
              {isFavorite ? '★' : '☆'}
            </span>
          )}
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
            <SwipeableProductRow
              key={item.product_id}
              item={item}
              onConsume={onConsume}
              onAdd={onAdd}
              onOpen={onOpen}
              onItemClick={onItemClick}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// Number of consecutive "no barcode" frames before the same barcode can be
// re-scanned.  At 10 fps this equals roughly 0.5 s of clear view.
const CLEAR_FRAMES_THRESHOLD = 5;

// Synthesize a short "blip" tone via Web Audio API — no external file needed.
function playBlip() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.08);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.08);
    osc.onended = () => ctx.close();
  } catch {
    // Web Audio not available — silent fallback
  }
}

// ---------------------------------------------------------------------------
// Barcode Scanner overlay
// Uses the phone (rear) camera to scan barcodes via html5-qrcode.
// Two modes:
//   - 'continuous' : keeps the camera running, fires onScan for every barcode,
//                    closes via Finish/Cancel and reports the scan count.
//   - 'single'     : fires onScan once and stops the camera; caller closes.
// Optionally renders a tap-to-expand strip of the last 3 scanned products.
// Falls back to manual barcode entry when camera is unavailable.
// ---------------------------------------------------------------------------
function BarcodeScanner({
  onScan,
  onClose,
  discoverQueueLength = 0,
  mode = 'single',
  title = 'Scan a barcode',
  recents = [],
  onShowAllRecents,
}) {
  const continuous = mode === 'continuous';

  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [cameraError, setCameraError] = useState(null);
  const [manualBarcode, setManualBarcode] = useState('');
  const [scanCount, setScanCount] = useState(0);

  // Duplicate-scan protection: ignore repeated reads of the same barcode
  // until the camera has been "clear" (no barcode visible) for several frames.
  const lastScannedRef = useRef(null);
  const clearFramesRef = useRef(0);

  useEffect(() => {
    const container = document.getElementById('barcode-reader');
    if (container) {
      while (container.firstChild) container.removeChild(container.firstChild);
    }

    const html5QrCode = new Html5Qrcode('barcode-reader');
    let stopped = false;
    setCameraError(null);

    html5QrCode
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          if (stopped) return;

          // Reset clear-frame counter — a barcode is visible
          clearFramesRef.current = 0;

          // Duplicate protection: skip if same barcode is still in view
          if (lastScannedRef.current === decodedText) return;

          if (continuous) {
            lastScannedRef.current = decodedText;
            setScanCount((c) => c + 1);
            playBlip();
            onScanRef.current(decodedText, { continuous: true });
          } else {
            stopped = true;
            playBlip();
            try {
              html5QrCode
                .stop()
                .catch(() => {})
                .finally(() => onScanRef.current(decodedText));
            } catch {
              onScanRef.current(decodedText);
            }
          }
        },
        () => {
          clearFramesRef.current++;
          if (clearFramesRef.current >= CLEAR_FRAMES_THRESHOLD) {
            lastScannedRef.current = null;
          }
        },
      )
      .catch(() => {
        setCameraError(
          'Unable to access camera. If you are using Home Assistant ingress, ' +
          'try opening the add-on in a new browser tab or enter the barcode manually below.',
        );
      });

    return () => {
      if (stopped) return;
      stopped = true;
      try {
        html5QrCode.stop().catch(() => {});
      } catch {
        // Container may already be removed; safe to ignore
      }
    };
  }, [continuous]);

  const handleManualSubmit = (e) => {
    e.preventDefault();
    const code = manualBarcode.trim();
    if (!code) return;
    playBlip();
    if (continuous) {
      setScanCount((c) => c + 1);
      onScanRef.current(code, { continuous: true });
      setManualBarcode('');
    } else {
      onScanRef.current(code);
    }
  };

  const visibleRecents = recents.slice(0, 3);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90">
      <div className="w-full max-w-sm px-4">
        <p className="text-center text-lg font-semibold mb-4 text-white">
          {continuous ? `${title} (${scanCount} scanned)` : title}
        </p>
        {continuous && discoverQueueLength > 0 && (
          <p className="text-center text-sm text-amber-400 mb-2">
            🔍 {discoverQueueLength} queued for lookup
          </p>
        )}
        <div id="barcode-reader" className="w-full rounded-lg overflow-hidden" />

        {continuous && visibleRecents.length > 0 && (
          <button
            type="button"
            onClick={() => onShowAllRecents?.()}
            className="w-full mt-3 px-3 py-2 bg-gray-800/80 hover:bg-gray-700 rounded-xl flex items-center gap-2 text-left transition-colors"
            aria-label="Show all scanned products this session"
          >
            <div className="flex -space-x-2 flex-shrink-0">
              {visibleRecents.map((r) => (
                <RecentChipThumb key={r.key} recent={r} />
              ))}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-semibold truncate">
                {visibleRecents[0].name}
                {visibleRecents[0].count > 1 ? ` × ${visibleRecents[0].count}` : ''}
              </p>
              <p className="text-gray-400 text-xs truncate">
                {recents.length > 1
                  ? `+${recents.length - 1} more — tap to view all`
                  : 'tap to view all'}
              </p>
            </div>
            <span className="text-gray-400 text-lg" aria-hidden="true">›</span>
          </button>
        )}

        {cameraError && (
          <>
            <p className="text-red-400 text-sm text-center mt-3">{cameraError}</p>
            <form onSubmit={handleManualSubmit} className="mt-4 flex gap-2">
              <input
                type="text"
                value={manualBarcode}
                onChange={(e) => setManualBarcode(e.target.value)}
                placeholder="Enter barcode number"
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-brand-cobalt"
                autoFocus
              />
              <button
                type="submit"
                disabled={!manualBarcode.trim()}
                className="px-4 py-2 bg-brand-cobalt hover:bg-brand-cobalt-400 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors"
              >
                Submit
              </button>
            </form>
          </>
        )}

        {continuous ? (
          <div className="mt-4 flex flex-col gap-2">
            <button
              onClick={() => onCloseRef.current({ scanned: 0 })}
              className="w-full py-2 px-5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-base font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onCloseRef.current({ scanned: scanCount })}
              className="w-full py-3 bg-brand-cobalt hover:bg-brand-cobalt-400 text-white rounded-lg text-lg font-semibold transition-colors"
            >
              Finish{scanCount > 0 ? ` (${scanCount} scanned)` : ''}
            </button>
          </div>
        ) : (
          <button
            onClick={() => onCloseRef.current({ scanned: 0 })}
            className="mt-4 w-full py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-lg font-semibold transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// Small thumbnail used in the recents strip — picture if available, else emoji.
function RecentChipThumb({ recent }) {
  const [failed, setFailed] = useState(false);
  const url = recent.picture && !failed ? thumbUrl(recent.picture) : null;
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="w-8 h-8 rounded-lg object-cover ring-2 ring-gray-900"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      className="w-8 h-8 rounded-lg bg-gray-700 flex items-center justify-center text-base ring-2 ring-gray-900"
      aria-hidden="true"
    >
      🥫
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScanPicker — bottom sheet shown when the header Scan button is tapped.
// Lets the user pick which scan flow to enter.
// ---------------------------------------------------------------------------
function ScanPicker({ onPick, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm overlay-enter"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm mx-0 sm:mx-4 overflow-hidden overlay-card-enter"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
          <h2 className="text-white text-lg font-bold">Scan</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 text-gray-200 text-base flex items-center justify-center transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="p-3 flex flex-col gap-2">
          <ScanPickerButton
            emoji="🛒"
            label="Scan shopping"
            description="Continuous — add scanned products to stock"
            onClick={() => onPick('shopping')}
          />
          <ScanPickerButton
            emoji="📋"
            label="Inventory"
            description="Continuous — count what's actually on the shelf"
            onClick={() => onPick('inventory')}
          />
          <ScanPickerButton
            emoji="➕"
            label="Add to shopping list"
            description="Single scan — sends one product to the shopping list"
            onClick={() => onPick('shopping-list')}
          />
        </div>
      </div>
    </div>
  );
}

function ScanPickerButton({ emoji, label, description, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full px-4 py-3 bg-gray-700 hover:bg-gray-600 active:bg-gray-600/80 rounded-xl flex items-center gap-3 text-left transition-colors"
    >
      <div className="w-12 h-12 rounded-xl bg-gray-800 flex items-center justify-center text-2xl flex-shrink-0">
        {emoji}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-base font-semibold leading-tight">{label}</p>
        <p className="text-gray-400 text-xs mt-0.5">{description}</p>
      </div>
      <span className="text-gray-400 text-xl" aria-hidden="true">›</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// SessionRecentsSheet — bottom sheet showing the full per-session scan list.
// Opens on top of the active scanner when the recents strip is tapped.
// Supports swipe-right-to-add and swipe-left-to-remove on each row when an
// onAdjust callback is provided (lets the user fix mistakes).
// ---------------------------------------------------------------------------
function SessionRecentsSheet({ recents, title = 'Scanned this session', onClose, onAdjust }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm overlay-enter"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm mx-0 sm:mx-4 overflow-hidden overlay-card-enter flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)', maxHeight: '70vh' }}
      >
        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
          <h2 className="text-white text-lg font-bold">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 text-gray-200 text-base flex items-center justify-center transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {onAdjust && recents.length > 0 && (
          <p className="px-5 pb-2 text-gray-400 text-xs">
            Swipe right to add 1, left to remove 1.
          </p>
        )}
        <div className="px-3 pb-3 overflow-y-auto">
          {recents.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">
              Nothing scanned yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {recents.map((r) => (
                <li key={r.id}>
                  <SwipeableRecentRow
                    recent={r}
                    onAdjust={onAdjust ? (delta) => onAdjust(r, delta) : null}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SwipeableRecentRow — recents row with horizontal swipe gestures.
// Swipe right past threshold = +1, swipe left past threshold = −1.
// Only locks horizontal once the user clearly drags sideways, so vertical
// scrolling of the parent sheet still works.
// ---------------------------------------------------------------------------
function SwipeableRecentRow({ recent, onAdjust }) {
  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const startRef = useRef(null);
  const lockedAxisRef = useRef(null); // 'x' | 'y' | null
  const SWIPE_TRIGGER = 90;
  const MAX_PULL = 140;

  const reset = (animate = true) => {
    setAnimating(animate);
    setDx(0);
    startRef.current = null;
    lockedAxisRef.current = null;
  };

  const handlePointerDown = (e) => {
    if (!onAdjust) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY };
    lockedAxisRef.current = null;
    setAnimating(false);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  };

  const handlePointerMove = (e) => {
    if (!onAdjust) return;
    const start = startRef.current;
    if (!start) return;
    const rawDx = e.clientX - start.x;
    const rawDy = e.clientY - start.y;
    if (lockedAxisRef.current === null) {
      if (Math.abs(rawDx) < 8 && Math.abs(rawDy) < 8) return;
      lockedAxisRef.current = Math.abs(rawDx) > Math.abs(rawDy) ? 'x' : 'y';
      if (lockedAxisRef.current === 'y') {
        startRef.current = null;
        return;
      }
    }
    if (lockedAxisRef.current !== 'x') return;
    e.preventDefault();
    const clamped = Math.max(-MAX_PULL, Math.min(MAX_PULL, rawDx));
    setDx(clamped);
  };

  const handlePointerUp = () => {
    if (!onAdjust) return;
    if (lockedAxisRef.current !== 'x') {
      reset(false);
      return;
    }
    if (dx >= SWIPE_TRIGGER) {
      onAdjust(+1);
    } else if (dx <= -SWIPE_TRIGGER) {
      onAdjust(-1);
    }
    reset(true);
  };

  const handlePointerCancel = () => reset(false);

  const showAdd = dx > 0;
  const showRemove = dx < 0;
  const intensity = Math.min(1, Math.abs(dx) / SWIPE_TRIGGER);
  const isPastTrigger = Math.abs(dx) >= SWIPE_TRIGGER;

  return (
    <div className="relative overflow-hidden rounded-xl select-none">
      {/* Add background (revealed on swipe right) */}
      <div
        className={`absolute inset-0 flex items-center justify-start pl-5 transition-colors ${
          isPastTrigger && showAdd ? 'bg-emerald-600' : 'bg-emerald-700/60'
        }`}
        style={{ opacity: showAdd ? intensity : 0 }}
        aria-hidden="true"
      >
        <span className="text-white text-base font-bold">＋ add 1</span>
      </div>
      {/* Remove background (revealed on swipe left) */}
      <div
        className={`absolute inset-0 flex items-center justify-end pr-5 transition-colors ${
          isPastTrigger && showRemove ? 'bg-red-600' : 'bg-red-700/60'
        }`}
        style={{ opacity: showRemove ? intensity : 0 }}
        aria-hidden="true"
      >
        <span className="text-white text-base font-bold">remove 1 −</span>
      </div>
      {/* Foreground row */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        className={`relative px-3 py-2 bg-gray-700/95 rounded-xl flex items-center gap-3 ${onAdjust ? 'cursor-grab active:cursor-grabbing' : ''}`}
        style={{
          transform: `translateX(${dx}px)`,
          transition: animating ? 'transform 180ms ease-out' : 'none',
          touchAction: 'pan-y',
        }}
      >
        <RecentChipThumb recent={recent} />
        <p className="text-white text-sm font-medium flex-1 truncate">
          {recent.name}
        </p>
        {recent.count > 1 && (
          <span className="text-gray-300 text-sm font-semibold">
            × {recent.count}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------------------
function Toasts({ toasts }) {
  return (
    <div className="fixed top-4 left-4 right-4 z-50 flex flex-col gap-2 pointer-events-none items-end">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`relative rounded-lg shadow-lg text-white text-sm max-w-xs pointer-events-auto overflow-hidden ${
            t.type === 'error'
              ? 'bg-red-600'
              : t.type === 'undo'
                ? 'bg-gray-700'
                : t.type === 'info'
                  ? 'bg-blue-600'
                  : 'bg-emerald-600'
          }`}
          role="alert"
        >
          <div className="px-4 py-3 flex items-center gap-3">
            <span className="flex-1">{t.message}</span>
            {t.onUndo && (
              <button
                onClick={t.onUndo}
                className="font-semibold text-brand-orange hover:text-brand-orange-400 underline flex-shrink-0"
              >
                Undo
              </button>
            )}
          </div>
          {t.type === 'undo' && (
            <div
              className="h-1 bg-brand-orange"
              style={{ animation: 'toast-shrink 5s linear forwards' }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ShoppingListOverlay
// Full-screen overlay that shows the HA-Storage shopping list, sorted by
// Finnish-grocery aisle, with smart suggestions for parent products and a
// quick-add bar that combines local fuzzy search, scraper fallback (top 4
// remote results) and a free-text "note" tail option.
// ---------------------------------------------------------------------------
function ShoppingListOverlay({
  list,
  products,
  productGroups,
  scraperAvailable,
  recommendations,
  onClose,
  onToggleDone,
  onUpdateAmount,
  onDeleteItem,
  onClearDone,
  onAddByProduct,
  onAddByEan,
  onAddNote,
  onSwapToChild,
}) {
  // Match the 350ms-interactive guard used by ProductDetailOverlay so the
  // backdrop click doesn't fire a phantom synthetic tap right after mount.
  const [interactive, setInteractive] = useState(false);
  useEffect(() => {
    setInteractive(false);
    const id = setTimeout(() => setInteractive(true), 350);
    return () => clearTimeout(id);
  }, []);

  // Indexes for fast lookups in render -------------------------------------
  const productById = useMemo(() => {
    const m = new Map();
    for (const p of products || []) m.set(p.id, p);
    return m;
  }, [products]);

  const groupById = useMemo(() => {
    const m = new Map();
    for (const g of productGroups || []) m.set(g.id, g);
    return m;
  }, [productGroups]);

  // Children index: parent_id → array of child products. Used by the
  // "usually bought" chip strip.
  const childrenByParent = useMemo(() => {
    const m = new Map();
    for (const p of products || []) {
      if (p.parent_id != null) {
        if (!m.has(p.parent_id)) m.set(p.parent_id, []);
        m.get(p.parent_id).push(p);
      }
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
    return m;
  }, [products]);

  // Sort + group the shopping list by Finnish aisle ------------------------
  const aisles = useMemo(() => {
    const buckets = new Map(); // aisleIdx → { idx, label, items: [] }
    for (const item of list || []) {
      const product = productById.get(item.product_id);
      const groupName = product?.product_group_id != null
        ? groupById.get(product.product_group_id)?.name
        : '';
      const aisle = aisleFor(groupName);
      if (!buckets.has(aisle.idx)) {
        buckets.set(aisle.idx, { idx: aisle.idx, label: aisle.label, items: [] });
      }
      buckets.get(aisle.idx).items.push({
        item,
        product,
        groupName: groupName || '',
      });
    }
    const out = [...buckets.values()].sort((a, b) => a.idx - b.idx);
    for (const bucket of out) {
      bucket.items.sort((a, b) => {
        // done items sink to the bottom of their aisle
        const da = a.item.done ? 1 : 0;
        const db = b.item.done ? 1 : 0;
        if (da !== db) return da - db;
        const ga = (a.groupName || '').localeCompare(b.groupName || '');
        if (ga !== 0) return ga;
        const na = a.product?.name ?? a.item.ha_item_name ?? '';
        const nb = b.product?.name ?? b.item.ha_item_name ?? '';
        return na.localeCompare(nb);
      });
    }
    return out;
  }, [list, productById, groupById]);

  const doneCount = (list || []).filter((i) => i.done).length;

  return (
    <div
      className="fixed inset-0 z-40 bg-gray-900 flex flex-col overlay-enter"
      style={{ pointerEvents: interactive ? 'auto' : 'none' }}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 bg-gray-800 text-white px-4 py-3 shadow-md border-b border-gray-700 flex items-center gap-3">
        <button
          onClick={onClose}
          className="px-3 h-9 rounded-full bg-gray-700 hover:bg-gray-600 text-sm font-medium"
          aria-label="Close shopping list"
        >
          ← Sulje
        </button>
        <h1 className="text-lg font-bold tracking-tight flex-1 truncate">
          🛒 Ostoslista
        </h1>
        {doneCount > 0 && (
          <button
            onClick={onClearDone}
            className="px-3 h-9 rounded-full bg-gray-700 hover:bg-red-600 text-xs font-semibold"
            title="Tyhjennä valmiit"
          >
            Tyhjennä ({doneCount})
          </button>
        )}
      </header>

      {/* ── Quick-add bar ─────────────────────────────────────────────── */}
      <ShoppingQuickAdd
        products={products}
        scraperAvailable={scraperAvailable}
        onAddByProduct={onAddByProduct}
        onAddByEan={onAddByEan}
        onAddNote={onAddNote}
      />

      {/* ── List body ─────────────────────────────────────────────────── */}
      <main
        className="flex-1 overflow-y-auto px-3 pb-8"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}
      >
        {(list || []).length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <p className="text-5xl mb-3" aria-hidden="true">🧺</p>
            <p className="text-lg">Ostoslista on tyhjä.</p>
            <p className="text-sm mt-2 text-gray-600">
              Etsi tuote yltä ja lisää listalle.
            </p>
          </div>
        ) : (
          aisles.map((aisle) => (
            <section key={aisle.idx} className="mt-4">
              <h2 className="text-xs font-bold uppercase tracking-wider text-brand-orange/90 px-1 pb-1 border-b border-gray-700/60 mb-2">
                {aisle.label}
              </h2>
              <ul className="space-y-2">
                {aisle.items.map(({ item, product }) => (
                  <ShoppingListRow
                    key={item.id}
                    item={item}
                    product={product}
                    variants={childrenByParent.get(item.product_id) ?? []}
                    onToggleDone={onToggleDone}
                    onDeleteItem={onDeleteItem}
                    onUpdateAmount={onUpdateAmount}
                    onSwapToChild={onSwapToChild}
                  />
                ))}
              </ul>
            </section>
          ))
        )}

        {/* Suositukset — recently fully-consumed products not kept in stock */}
        {(recommendations || []).length > 0 && (
          <section className="mt-6">
            <h2 className="text-xs font-bold uppercase tracking-wider text-brand-orange/90 px-1 pb-1 border-b border-gray-700/60 mb-2">
              💡 Suositukset
            </h2>
            <p className="text-xs text-gray-500 px-1 mb-2">
              Viimeksi loppuunkulutetut tuotteet. Lisää listalle yhdellä napautuksella.
            </p>
            <ul className="space-y-2">
              {recommendations.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onAddByProduct?.(p)}
                    className="w-full px-3 py-2 bg-gray-800 hover:bg-gray-700 active:bg-gray-700/80 rounded-xl flex items-center gap-3 text-left transition-colors"
                  >
                    <ProductThumbnail
                      imageUrl={pictureUrl(p.picture_filename)}
                      name={p.name}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">
                        {p.name}
                      </p>
                      <p className="text-gray-500 text-xs">Loppu varastosta</p>
                    </div>
                    <span className="text-brand-cobalt-300 text-xl font-bold" aria-hidden="true">＋</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ShoppingQuickAdd
// Search bar that combines local fuzzy search, scraper fallback (when local
// has no hits and query length ≥ 3) and a free-text "Add as note" tail row.
// ---------------------------------------------------------------------------
function ShoppingQuickAdd({
  products,
  scraperAvailable,
  onAddByProduct,
  onAddByEan,
  onAddNote,
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [scraperDebounced, setScraperDebounced] = useState('');
  const [scraperResults, setScraperResults] = useState([]);
  const [scraperLoading, setScraperLoading] = useState(false);
  const [scraperError, setScraperError] = useState(null);
  const inputRef = useRef(null);
  const reqIdRef = useRef(0);

  // Local fuzzy: short debounce so suggestions feel snappy.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  // Scraper search: longer debounce — the K-Ruoka pipeline only handles one
  // search at a time and returns 409 (busy) if a request lands while another
  // is in flight. Wait until the user has stopped typing for 2s before
  // hitting the network.
  useEffect(() => {
    if (scraperDebounced && !query.trim()) {
      // Input cleared — drop the pending scraper query immediately so stale
      // results disappear without waiting out the 2s timer.
      setScraperDebounced('');
      return undefined;
    }
    const id = setTimeout(() => setScraperDebounced(query.trim()), 2000);
    return () => clearTimeout(id);
  }, [query, scraperDebounced]);

  // Local fuzzy results: top 8 active products by score.
  const localResults = useMemo(() => {
    if (!debounced) return [];
    const out = [];
    for (const p of products || []) {
      if (p.active === 0) continue;
      // Hide the note sentinel from suggestions — it's an implementation
      // detail used to back free-text rows.
      if (p.name === NOTE_SENTINEL_NAME) continue;
      const score = fuzzyScore(debounced, p.name);
      if (score >= 50) out.push({ p, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 8).map((x) => x.p);
  }, [debounced, products]);

  // Scraper search: ALWAYS fires (when scraper is available + query is
  // substantive) so the user can find products that aren't in the local DB
  // even when their query has near-misses among local products.
  // The scraper uses fire-and-poll: POST /search returns {task_id, status:
  // "running"}, then we poll GET /task/{id} until status === "done".
  // Driven by `scraperDebounced` (2s pause) — the scraper accepts only one
  // job at a time and returns 409 if hammered mid-typing.
  useEffect(() => {
    if (!scraperAvailable) {
      setScraperResults([]);
      setScraperError(null);
      setScraperLoading(false);
      return;
    }
    if (!scraperDebounced || scraperDebounced.length < 3) {
      setScraperResults([]);
      setScraperError(null);
      setScraperLoading(false);
      return;
    }
    const myId = ++reqIdRef.current;
    let cancelled = false;
    let pollTimer = null;
    let retryTimer = null;
    setScraperLoading(true);
    setScraperError(null);

    const finish = (data) => {
      if (cancelled || myId !== reqIdRef.current) return;
      const found = Array.isArray(data?.products) ? data.products.slice(0, 4) : [];
      setScraperResults(found);
      if (data?.success === false && data?.error) {
        setScraperError(String(data.error));
      }
      setScraperLoading(false);
    };
    const fail = (err) => {
      if (cancelled || myId !== reqIdRef.current) return;
      setScraperError(
        err?.response?.data?.detail ?? err?.message ?? 'Haku epäonnistui',
      );
      setScraperResults([]);
      setScraperLoading(false);
    };

    const POLL_INTERVAL = 600;
    const POLL_DEADLINE = Date.now() + 30_000;

    const pollOnce = (taskId) => {
      if (cancelled || myId !== reqIdRef.current) return;
      if (Date.now() > POLL_DEADLINE) {
        fail(new Error('Aikakatkaisu'));
        return;
      }
      axios
        .get(`${SCRAPER_API}/task/${taskId}`, { timeout: 10_000 })
        .then((res) => {
          if (cancelled || myId !== reqIdRef.current) return;
          const status = res.data?.status;
          if (status === 'done' || status === 'completed' || status === 'success') {
            finish(res.data);
          } else if (status === 'error' || status === 'failed') {
            fail(new Error(res.data?.error ?? 'Haku epäonnistui'));
          } else {
            pollTimer = setTimeout(() => pollOnce(taskId), POLL_INTERVAL);
          }
        })
        .catch(fail);
    };

    let busyRetries = 0;
    const startSearch = () => {
      if (cancelled || myId !== reqIdRef.current) return;
      axios
        .post(
          `${SCRAPER_API}/search`,
          { query: scraperDebounced, max_products: 50 },
          { timeout: 15_000 },
        )
        .then((res) => {
          if (cancelled || myId !== reqIdRef.current) return;
          const data = res.data;
          // Older / synchronous deployments may already include products.
          if (Array.isArray(data?.products)) {
            finish(data);
            return;
          }
          if (data?.task_id) {
            pollOnce(data.task_id);
          } else {
            finish(data ?? {});
          }
        })
        .catch((err) => {
          // 409 = scraper busy with another job. Back off briefly and retry
          // up to 3 times so a previous in-flight search clears.
          if (err?.response?.status === 409 && busyRetries < 3) {
            busyRetries += 1;
            retryTimer = setTimeout(startSearch, 1500);
            return;
          }
          fail(err);
        });
    };
    startSearch();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [scraperDebounced, scraperAvailable]);

  const reset = () => {
    setQuery('');
    setDebounced('');
    setScraperDebounced('');
    setScraperResults([]);
    setScraperError(null);
  };

  const handleAddProduct = (p) => {
    onAddByProduct(p);
    reset();
    inputRef.current?.focus();
  };
  const handleAddEan = (sp) => {
    onAddByEan(sp);
    reset();
    inputRef.current?.focus();
  };
  const handleAddNote = () => {
    const text = query.trim();
    if (!text) return;
    onAddNote(text);
    reset();
    inputRef.current?.focus();
  };

  const showSuggestions = debounced.length > 0;

  return (
    <div className="bg-gray-800/95 border-b border-gray-700 px-3 py-2 sticky top-[56px] z-[5]">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Etsi tai lisää tuote…"
          className="w-full h-11 pl-10 pr-10 rounded-xl bg-gray-700 text-white placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-brand-orange/60"
          autoComplete="off"
          inputMode="search"
        />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true">🔍</span>
        {query && (
          <button
            onClick={reset}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-gray-400 hover:text-white text-sm"
            aria-label="Tyhjennä haku"
          >
            ✕
          </button>
        )}
      </div>

      {showSuggestions && (
        <div className="mt-2 max-h-[60vh] overflow-y-auto rounded-xl bg-gray-700/40 border border-gray-700">
          {/* Local product hits */}
          {localResults.length > 0 && (
            <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider font-semibold text-gray-400">
              Omat tuotteet
            </div>
          )}
          {localResults.map((p) => (
            <button
              key={`p-${p.id}`}
              onClick={() => handleAddProduct(p)}
              className="w-full px-3 py-2 flex items-center gap-3 hover:bg-gray-700/80 active:bg-gray-700 text-left"
            >
              <ProductThumbnail
                imageUrl={pictureUrl(p.picture_filename)}
                name={p.name}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">{p.name}</p>
                <p className="text-xs text-gray-400 truncate">
                  {p.product_group_id != null ? '' : 'Ei ryhmää'}
                </p>
              </div>
              <span className="text-emerald-400 text-lg" aria-hidden="true">＋</span>
            </button>
          ))}

          {/* K-Ruoka scraper results — ALWAYS shown when scraper is available
              and query is substantive, so products that are similar to a
              local one but not yet in the DB can still be added. */}
          {scraperAvailable && debounced.length >= 3 && (
            <div className={localResults.length > 0 ? 'border-t border-gray-700/70' : ''}>
              <div className="px-3 pt-2 pb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider font-semibold text-blue-300">
                <span>K-Ruoka</span>
                {scraperLoading && (
                  <span className="text-gray-400 normal-case tracking-normal">— etsitään…</span>
                )}
              </div>
              {!scraperLoading && scraperResults.map((sp, idx) => (
                <button
                  key={`sp-${idx}-${sp.ean || sp.name}`}
                  onClick={() => handleAddEan(sp)}
                  className="w-full px-3 py-2 flex items-center gap-3 hover:bg-gray-700/80 active:bg-gray-700 text-left"
                >
                  <ProductThumbnail imageUrl={sp.image_url || null} name={sp.name} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{sp.name}</p>
                    <p className="text-xs text-blue-300 truncate flex items-center gap-1">
                      <span className="inline-block px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[10px] font-semibold uppercase">
                        K-Ruoka
                      </span>
                      {sp.ean ? <span>· {sp.ean}</span> : null}
                    </p>
                  </div>
                  <span className="text-blue-400 text-lg" aria-hidden="true">↗</span>
                </button>
              ))}
              {!scraperLoading && scraperResults.length === 0 && (
                <p className="px-3 py-2 text-xs text-gray-500">
                  {scraperError ?? 'Ei osumia K-Ruoasta.'}
                </p>
              )}
            </div>
          )}

          {/* Always-available free-text fallback */}
          <button
            onClick={handleAddNote}
            className="w-full px-3 py-2 flex items-center gap-3 hover:bg-gray-700/80 active:bg-gray-700 text-left border-t border-gray-700"
          >
            <div className="w-12 h-12 flex-shrink-0 rounded-lg bg-gray-700 flex items-center justify-center text-2xl select-none">
              📝
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white font-medium truncate">
                Lisää muistilappuna: "{query.trim() || '…'}"
              </p>
              <p className="text-xs text-gray-400">Vapaa teksti listalle</p>
            </div>
            <span className="text-emerald-400 text-lg" aria-hidden="true">＋</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ShoppingListRow
// One item row with done toggle, amount stepper, swipe-left delete and the
// "usually bought" child-product chip strip when applicable.
// ---------------------------------------------------------------------------
function ShoppingListRow({
  item,
  product,
  variants,
  onToggleDone,
  onDeleteItem,
  onUpdateAmount,
  onSwapToChild,
}) {
  const name = product?.name ?? item.ha_item_name ?? `#${item.product_id}`;
  const isNote = product?.name === NOTE_SENTINEL_NAME;
  const displayName = isNote ? (item.note || 'Muistilappu') : name;
  const note = isNote ? '' : (item.note || '');
  const imgUrl = isNote ? null : pictureUrl(product?.picture_filename);

  const amount = parseFloat(item.amount ?? 1) || 1;

  const handleDec = (e) => {
    e.stopPropagation();
    if (amount <= 1) {
      onDeleteItem(item);
    } else {
      onUpdateAmount(item, amount - 1);
    }
  };
  const handleInc = (e) => {
    e.stopPropagation();
    onUpdateAmount(item, amount + 1);
  };

  return (
    <li className={`bg-gray-800 rounded-xl border border-gray-700/60 ${item.done ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3 px-3 py-2">
        {/* Done toggle */}
        <button
          onClick={() => onToggleDone(item)}
          className={`w-7 h-7 flex-shrink-0 rounded-full border-2 flex items-center justify-center text-xs ${
            item.done
              ? 'bg-emerald-500 border-emerald-500 text-white'
              : 'border-gray-500 text-transparent hover:border-emerald-400'
          }`}
          aria-label={item.done ? 'Merkitse tekemättömäksi' : 'Merkitse valmiiksi'}
        >
          ✓
        </button>

        {isNote ? (
          <div className="w-12 h-12 flex-shrink-0 rounded-lg bg-gray-700 flex items-center justify-center text-2xl select-none">
            📝
          </div>
        ) : (
          <ProductThumbnail imageUrl={imgUrl} name={displayName} />
        )}

        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium truncate ${item.done ? 'line-through text-gray-500' : 'text-white'}`}>
            {displayName}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {item.auto_added ? (
              <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                Vähissä
              </span>
            ) : null}
            {note && (
              <p className="text-xs text-gray-400 truncate">📝 {note}</p>
            )}
          </div>
        </div>

        {/* Amount stepper */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={handleDec}
            className="w-7 h-7 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-base leading-none"
            aria-label="Vähennä"
          >
            −
          </button>
          <span className="text-sm text-white font-semibold w-6 text-center">
            {amount % 1 === 0 ? amount : amount.toFixed(1)}
          </span>
          <button
            onClick={handleInc}
            className="w-7 h-7 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-base leading-none"
            aria-label="Lisää"
          >
            +
          </button>
        </div>

        {/* Delete */}
        <button
          onClick={() => onDeleteItem(item)}
          className="w-7 h-7 flex-shrink-0 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10"
          aria-label="Poista"
          title="Poista"
        >
          🗑
        </button>
      </div>

      {/* "Usually bought" child suggestions for parent products */}
      {!item.done && variants.length > 0 && (
        <div className="px-3 pb-2 -mt-1">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pt-1">
            {variants.map((child) => (
              <button
                key={child.id}
                onClick={() => onSwapToChild(item, child)}
                className="flex-shrink-0 px-3 py-1 rounded-full bg-gray-700/70 hover:bg-brand-orange/80 text-xs font-medium text-gray-200 hover:text-white transition-colors"
                title={`Vaihda: ${child.name}`}
              >
                {child.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  const [storageReady, setStorageReady] = useState(false);
  const [storageChecking, setStorageChecking] = useState(true);
  const [stockItems, setStockItems] = useState([]);
  const [productGroups, setProductGroups] = useState([]);
  const [locations, setLocations] = useState([]);
  const [selectedLocationId, setSelectedLocationId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [keepDialog, setKeepDialog] = useState(null); // {productName, parentName, parentId, productId}
  const [showScanPicker, setShowScanPicker] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [shoppingAttribution, setShoppingAttribution] = useState(null);
  // shoppingAttribution shape: { scanCount: number } | null
  const [showInventoryScanner, setShowInventoryScanner] = useState(false);
  const [showShoppingListScanner, setShowShoppingListScanner] = useState(false);
  const [showRecentsSheet, setShowRecentsSheet] = useState(false);
  const [scraperAvailable, setScraperAvailable] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  // Shopping list state — populated alongside stock by fetchStockData.
  const [allProducts, setAllProducts] = useState([]);
  const [shoppingList, setShoppingList] = useState([]);
  const [showShoppingList, setShowShoppingList] = useState(false);
  // Recent consume events (for Suositukset suggestions in shopping list).
  // Refreshed each time the shopping list overlay opens.
  const [consumeHistory, setConsumeHistory] = useState([]);
  // Favourite product groups — IDs stored as strings so __ungrouped__ and
  // numeric ids can coexist. Persisted to localStorage so the user's choices
  // survive reloads.
  const [favoriteGroups, setFavoriteGroups] = useState(() => {
    try {
      const raw = localStorage.getItem('stock.favoriteGroups');
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
    } catch {
      return new Set();
    }
  });
  const toggleFavoriteGroup = useCallback((gid) => {
    setFavoriteGroups((prev) => {
      const next = new Set(prev);
      const key = String(gid);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(
          'stock.favoriteGroups',
          JSON.stringify([...next]),
        );
      } catch {
        // Storage quota / private mode — favourites just won't persist.
      }
      return next;
    });
  }, []);
  // Cached id of the lazily-created "Muistilappu" sentinel product used to
  // back free-text shopping-list rows. Null until the first note is added.
  const noteSentinelIdRef = useRef(null);
  // Tracks product ids for which an auto-add to the shopping list is
  // currently in flight, so we don't fire duplicate POSTs while a sync cycle
  // hasn't yet observed the new row.
  const autoAddInFlightRef = useRef(new Set());
  const lastScanTimeRef = useRef(0);
  const lastScanBarcodeRef = useRef(null);
  const SCAN_COOLDOWN_MS = 5000;
  // Inventory mode: accumulate per-product counts instead of adding stock immediately
  const inventoryCountsRef = useRef({});  // productId → scanned count
  const inventoryNamesRef = useRef({});   // productId → product name
  const [inventoryCounts, setInventoryCounts] = useState({});
  const invLastBarcodeRef = useRef(null); // inventory-specific cooldown (avoids clashing with normal scan)
  const invLastTimeRef = useRef(0);

  // Per-session recents lists for the two continuous scan modes.
  // Each entry: { key, name, picture, count } — count merges duplicate scans.
  const [shoppingRecents, setShoppingRecents] = useState([]);
  const [inventoryRecents, setInventoryRecents] = useState([]);

  // Single-fire shopping-list flow: when an unknown barcode is scanned we
  // enqueue discover and remember to add the product to the shopping list
  // once it lands. Map<barcode, count>.
  const pendingShoppingAddsRef = useRef({});

  // Continuous shopping-scan flow: when an unknown barcode is scanned during
  // "Scan shopping" we enqueue discover and remember how many units to push
  // into the session recents list once the product lands. Map<barcode, count>.
  const pendingShoppingRecentsRef = useRef({});

  // ---- Discover queue for unknown barcodes ---------------------------------
  // Barcodes are enqueued when unknown during continuous scanning and
  // processed one-at-a-time so the server's single-operation lock is
  // respected instead of returning 409 and losing barcodes.
  const discoverQueueRef = useRef([]);
  const [discoverQueue, setDiscoverQueue] = useState([]);
  const isDiscoveringRef = useRef(false);
  // Extra scan counts accumulated while a barcode is being discovered.
  // When discovery completes, this many additional units are added to stock.
  const discoverPendingCountsRef = useRef({});

  // ---- Double-tap to collapse/expand all product groups -------------------
  const [allGroupsExpanded, setAllGroupsExpanded] = useState(true);
  const [groupExpandKey, setGroupExpandKey] = useState(0);
  const lastTabTapRef = useRef({ id: null, time: 0 });
  const DOUBLE_TAP_MS = 400;

  const handleTabClick = useCallback((locationId) => {
    const now = Date.now();
    const last = lastTabTapRef.current;

    if (
      last.time > 0 &&
      String(last.id) === String(locationId) &&
      String(selectedLocationId) === String(locationId) &&
      now - last.time < DOUBLE_TAP_MS
    ) {
      // Double-tap on already-selected tab → toggle all groups
      setAllGroupsExpanded((prev) => !prev);
      setGroupExpandKey((k) => k + 1);
      lastTabTapRef.current = { id: null, time: 0 };
      return;
    }

    lastTabTapRef.current = { id: locationId, time: now };

    // Single tap on a different tab → switch location
    if (String(selectedLocationId) !== String(locationId)) {
      setSelectedLocationId(locationId);
    }
  }, [selectedLocationId]);

  // Derive the selected item from current stock so it stays in sync
  const selectedItem = selectedProductId
    ? stockItems.find((i) => i.product_id === selectedProductId) ?? null
    : null;

  // ---- Fetch parent product when overlay opens for a child product ----------
  const [parentProduct, setParentProduct] = useState(null);

  useEffect(() => {
    const parentId = selectedItem?.product?.parent_id;
    if (!parentId) {
      setParentProduct(null);
      return;
    }
    let cancelled = false;
    axios
      .get(`${API_BASE}/products/${parentId}`)
      .then((resp) => {
        if (!cancelled) setParentProduct(resp.data ?? null);
      })
      .catch(() => {
        if (!cancelled) setParentProduct(null);
      });
    return () => { cancelled = true; };
  }, [selectedItem?.product_id, selectedItem?.product?.parent_id]);

  // ---- Recent consume history → Suositukset ---------------------------------
  // Fetched whenever the shopping list overlay opens. Used to compute the 5
  // most recently fully-consumed (stock=0) products that are NOT kept in stock,
  // shown as a "Suositukset" strip at the bottom of the shopping list.
  useEffect(() => {
    if (!showShoppingList) return;
    let cancelled = false;
    axios
      .get(`${API_BASE}/history`, {
        params: { event_type: 'consume', limit: 100 },
      })
      .then((resp) => {
        if (!cancelled) {
          setConsumeHistory(Array.isArray(resp.data) ? resp.data : []);
        }
      })
      .catch(() => {
        if (!cancelled) setConsumeHistory([]);
      });
    return () => { cancelled = true; };
  }, [showShoppingList]);

  // Compute Suositukset: walk consume history newest-first, pick first 5
  // unique products that:
  //   • are currently at zero stock (not present in stockItems)
  //   • are not kept in stock (min_stock_amount < 1)
  //   • are still active
  //   • are not already on the open shopping list
  //   • are not the note sentinel
  const shoppingRecommendations = useMemo(() => {
    if (!consumeHistory.length) return [];
    const productById = new Map();
    for (const p of allProducts || []) productById.set(p.id, p);
    const stockedIds = new Set((stockItems || []).map((i) => i.product_id));
    const onListIds = new Set(
      (shoppingList || [])
        .filter((row) => !row.done && row.product_id != null)
        .map((row) => row.product_id),
    );
    const seen = new Set();
    const out = [];
    for (const ev of consumeHistory) {
      const pid = ev.product_id;
      if (pid == null || seen.has(pid)) continue;
      seen.add(pid);
      const product = productById.get(pid);
      if (!product) continue;
      if (product.name === NOTE_SENTINEL_NAME) continue;
      if (product.active === 0) continue;
      if (parseFloat(product.min_stock_amount ?? 0) >= 1) continue;
      if (stockedIds.has(pid)) continue;
      if (onListIds.has(pid)) continue;
      out.push(product);
      if (out.length >= 5) break;
    }
    return out;
  }, [consumeHistory, allProducts, stockItems, shoppingList]);

  // ---- Toast helper --------------------------------------------------------
  const addToast = useCallback((message, type = 'error') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      4000,
    );
  }, []);

  // ---- Pending-mutation guard -----------------------------------------------
  // Tracks how many optimistic mutations are in-flight so background sync
  // can skip updates while the user has uncommitted changes (e.g. undo window).
  const pendingMutations = useRef(0);

  // ---- Shared data-fetch helper -------------------------------------------
  const fetchStockData = useCallback(async () => {
    const [stockRes, groupsRes, locationsRes, productsRes, shoppingRes] = await Promise.all([
      axios.get(`${API_BASE}/stock`),
      axios.get(`${API_BASE}/product-groups`),
      axios.get(`${API_BASE}/locations`),
      axios.get(`${API_BASE}/products`),
      axios.get(`${API_BASE}/shopping-list`),
    ]);
    const items = Array.isArray(stockRes.data)
      ? stockRes.data
          .filter((item) => parseFloat(item.amount) > 0)
          .map((item) => ({
            ...item,
            amount: parseFloat(item.amount),
            amount_opened: parseFloat(item.amount_opened ?? 0),
          }))
      : [];
    return {
      items,
      groups: Array.isArray(groupsRes.data) ? groupsRes.data : [],
      locations: Array.isArray(locationsRes.data) ? locationsRes.data : [],
      products: Array.isArray(productsRes.data) ? productsRes.data : [],
      shoppingList: Array.isArray(shoppingRes.data)
        ? shoppingRes.data.map((row) => ({
            ...row,
            amount: parseFloat(row.amount ?? 1),
            done: !!row.done,
            auto_added: !!row.auto_added,
          }))
        : [],
    };
  }, []);

  // ---- Apply fetched data to state ----------------------------------------
  const applyStockData = useCallback(({ items, groups, locations: locs, products, shoppingList }) => {
    setStockItems(items);
    setProductGroups(groups);
    setLocations(locs);
    if (products) setAllProducts(products);
    if (shoppingList) setShoppingList(shoppingList);
  }, []);

  // ---- Storage health check with retry ------------------------------------
  const [healthRetries, setHealthRetries] = useState(0);
  const MAX_HEALTH_RETRIES = 60;

  useEffect(() => {
    let cancelled = false;
    let timerId = null;
    let retryCount = 0;

    async function check() {
      try {
        await axios.get(`${API_BASE}/health`, { timeout: 5000 });
        if (!cancelled) {
          setStorageReady(true);
          setStorageChecking(false);
        }
      } catch {
        retryCount++;
        if (!cancelled) {
          setHealthRetries(retryCount);
          if (retryCount < MAX_HEALTH_RETRIES) {
            timerId = setTimeout(check, 5000);
          } else {
            setStorageChecking(false);
          }
        }
      }
    }

    check();
    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, []);

  // ---- Initial data fetch (waits for Storage to be ready) ----------------
  useEffect(() => {
    if (!storageReady) return;
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchStockData();
        if (!cancelled) applyStockData(data);
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
  }, [storageReady, fetchStockData, applyStockData]);

  // ---- Scraper availability check -----------------------------------------
  // Probe the scraper addon once on mount.  If it responds, the barcode
  // scan flow will auto-trigger discover for missing products.
  useEffect(() => {
    let cancelled = false;
    axios
      .get(`${SCRAPER_API}/config`, { timeout: 5000 })
      .then((res) => {
        if (!cancelled && res.data?.configured) setScraperAvailable(true);
      })
      .catch(() => {});  // scraper not installed / unreachable — silently disable
    return () => { cancelled = true; };
  }, []);

  // ---- Refresh stock data helper -------------------------------------------
  const refreshStock = useCallback(async () => {
    try {
      applyStockData(await fetchStockData());
    } catch {
      addToast('Stock list may be outdated — pull down to refresh.', 'error');
    }
  }, [fetchStockData, applyStockData, addToast]);

  // ---- Background sync (multi-device awareness) ---------------------------
  // Polls Storage at regular intervals so changes made on other devices are
  // reflected automatically. Skips updates while local mutations are pending,
  // adapts the polling interval based on tab visibility, and triggers an
  // immediate sync when the tab regains focus.
  useEffect(() => {
    const POLL_VISIBLE_MS = 30_000;   // 30 s when tab is active
    const POLL_HIDDEN_MS  = 60_000;   // 60 s when tab is in background

    let timerId = null;
    let destroyed = false;
    let syncing = false;

    const sync = async () => {
      // Skip when mutations are in-flight or another sync is already running
      if (syncing || pendingMutations.current > 0) return;
      syncing = true;
      try {
        const data = await fetchStockData();
        if (!destroyed && pendingMutations.current === 0) {
          applyStockData(data);
        }
        setDisconnected(false);
      } catch {
        setDisconnected(true);
      } finally {
        syncing = false;
      }
    };

    const schedule = () => {
      if (destroyed) return;
      const delay =
        document.visibilityState === 'hidden' ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
      timerId = setTimeout(() => {
        sync().finally(schedule);
      }, delay);
    };

    // Sync immediately when tab becomes visible again
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Clear existing timer and sync right away, then resume polling
        if (timerId) clearTimeout(timerId);
        sync().finally(schedule);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    schedule(); // Start the first polling cycle

    return () => {
      destroyed = true;
      if (timerId) clearTimeout(timerId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchStockData, applyStockData]);

  // ---- Auto-add low-stock items to the shopping list ----------------------
  // For every active product whose tracked stock is below `min_stock_amount`,
  // ensure a row exists on the shopping list. Already-listed products
  // (regardless of done state) are left alone so we don't spam the list while
  // the user is actively shopping. Once they clear done items, the next sync
  // will top-up anything that's still low.
  useEffect(() => {
    if (!storageReady) return;
    if (!Array.isArray(allProducts) || allProducts.length === 0) return;

    const stockMap = new Map();
    for (const it of stockItems) {
      stockMap.set(it.product_id, parseFloat(it.amount ?? 0));
    }
    const onList = new Set(shoppingList.map((r) => r.product_id));

    for (const p of allProducts) {
      if (!p.active) continue;
      const min = parseFloat(p.min_stock_amount ?? 0);
      if (!(min > 0)) continue;
      const have = stockMap.get(p.id) ?? 0;
      if (have >= min) continue;
      if (onList.has(p.id)) continue;
      if (autoAddInFlightRef.current.has(p.id)) continue;

      autoAddInFlightRef.current.add(p.id);
      const need = Math.max(1, Math.ceil(min - have));
      const tempId = `temp-auto-${p.id}-${Date.now()}`;
      const optimistic = {
        id: tempId,
        product_id: p.id,
        amount: need,
        unit_id: p.unit_id ?? null,
        note: '',
        done: false,
        recipe_id: null,
        auto_added: true,
        ha_item_name: p.name ?? null,
        created_at: new Date().toISOString(),
      };
      setShoppingList((prev) =>
        prev.some((r) => r.product_id === p.id) ? prev : [optimistic, ...prev],
      );
      pendingMutations.current++;
      axios
        .post(`${API_BASE}/shopping-list`, { product_id: p.id, amount: need, auto_added: true })
        .then((resp) => {
          const real = resp.data;
          setShoppingList((prev) =>
            prev.map((row) =>
              row.id === tempId
                ? {
                    ...real,
                    amount: parseFloat(real.amount ?? need),
                    done: !!real.done,
                    auto_added: !!real.auto_added,
                  }
                : row,
            ),
          );
        })
        .catch(() => {
          setShoppingList((prev) => prev.filter((row) => row.id !== tempId));
          autoAddInFlightRef.current.delete(p.id);
        })
        .finally(() => {
          pendingMutations.current = Math.max(0, pendingMutations.current - 1);
        });
    }

    // Clear in-flight markers for products that have either landed on the list
    // or recovered above min, so a future drop can re-trigger the auto-add.
    for (const pid of Array.from(autoAddInFlightRef.current)) {
      const have = stockMap.get(pid) ?? 0;
      const prod = allProducts.find((p) => p.id === pid);
      const min = parseFloat(prod?.min_stock_amount ?? 0);
      if (onList.has(pid) || have >= min) {
        autoAddInFlightRef.current.delete(pid);
      }
    }
  }, [storageReady, stockItems, allProducts, shoppingList]);

  // Helper: push a product into a per-session recents list, merging duplicates.
  // `increment` lets callers add multiple units at once (e.g. when discovery
  // completes and we need to retroactively credit the trigger scan plus any
  // extras that arrived during the lookup).
  const pushRecent = useCallback((setter, product, increment = 1) => {
    if (!product || product.id == null) return;
    if (increment <= 0) return;
    const id = product.id;
    const name = product.name ?? `#${id}`;
    const picture = product.picture_filename ?? null;
    const packSize = product.matched_pack_size ?? 1;
    setter((prev) => {
      const existing = prev.find((r) => r.id === id);
      const without = prev.filter((r) => r.id !== id);
      const existingCount = existing?.count ?? 0;
      return [
        {
          key: `${id}-${Date.now()}`,
          id,
          name,
          picture: picture ?? existing?.picture ?? null,
          packSize: existing?.packSize ?? packSize,
          count: existingCount + increment,
        },
        ...without,
      ];
    });
  }, []);

  // Helper: bump or drop a recents entry. Returns the entry for callers that
  // need it (e.g. to know packSize for the API call).
  const adjustRecentCount = useCallback((setter, productId, delta) => {
    setter((prev) => {
      const idx = prev.findIndex((r) => r.id === productId);
      if (idx === -1) return prev;
      const next = [...prev];
      const entry = next[idx];
      const newCount = entry.count + delta;
      if (newCount <= 0) {
        next.splice(idx, 1);
      } else {
        next[idx] = { ...entry, count: newCount, key: `${entry.id}-${Date.now()}` };
      }
      return next;
    });
  }, []);

  // Fire HA-Storage's AI optimizer for a single newly-created product. This
  // is the single-fire path used by both the scan/discover pipeline and the
  // shopping-list quick-add: after a product first lands in the database we
  // ask HA-Storage to fill in group / location / unit / parent / best-before /
  // pack quantity, then refresh `allProducts` so the UI picks up the new
  // metadata. Non-blocking — the caller does not await it.
  const triggerAiOptimize = useCallback(
    (productId) => {
      if (!productId) return;
      (async () => {
        try {
          const start = await axios.post(
            `${API_BASE}/ai/optimize`,
            { product_ids: [productId] },
            { timeout: 10_000 },
          );
          const taskId = start.data?.task_id;
          if (!taskId) return;
          addToast('🤖 AI luokittelee tuotetta…', 'info');
          const deadline = Date.now() + 90_000;
          // eslint-disable-next-line no-await-in-loop
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 1500));
            try {
              const r = await axios.get(
                `${API_BASE}/ai/optimize/${taskId}`,
                { timeout: 10_000 },
              );
              const status = r.data?.status;
              if (status === 'done') {
                try {
                  const list = await axios.get(`${API_BASE}/products`);
                  if (Array.isArray(list.data)) setAllProducts(list.data);
                } catch {
                  // Non-fatal — UI will pick up on the next poll cycle.
                }
                addToast('✅ AI valmis', 'success');
                return;
              }
              if (status === 'error') {
                addToast('AI-luokittelu epäonnistui.', 'error');
                return;
              }
            } catch (err) {
              if (err?.response?.status === 404) return;
              // Transient — keep polling.
            }
          }
        } catch (err) {
          // 409 = full optimize already running; the new product will be
          // picked up by that run, no action needed.
          if (err?.response?.status === 409) return;
          // Anything else: silent — the product already exists.
        }
      })();
    },
    [addToast],
  );

  // ---- Discover queue processor ---------------------------------------------
  // Processes queued unknown barcodes one at a time.  When a discover call
  // finishes (success or failure) the next item is picked up automatically.
  // If the server returns 409 (busy with a batch operation), the barcode is
  // kept in the queue and retried after a short delay.
  const DISCOVER_RETRY_DELAY_MS = 3000;

  const processDiscoverQueue = useCallback(async () => {
    if (isDiscoveringRef.current) return;        // already processing
    if (discoverQueueRef.current.length === 0) return; // nothing to do

    isDiscoveringRef.current = true;
    const barcode = discoverQueueRef.current[0]; // peek, don't shift yet

    try {
      const discoverRes = await axios.post(
        `${SCRAPER_API}/discover`,
        { barcode },
        { timeout: 120_000 },
      );

      // The scraper uses fire-and-poll: POST returns {task_id, status: "running"},
      // then we poll GET /api/task/{id} until it completes.
      let result = discoverRes.data;
      if (result?.task_id && result?.status === 'running') {
        const taskId = result.task_id;
        const POLL_INTERVAL = 2000;
        const POLL_TIMEOUT = 120_000;
        const start = Date.now();
        while (Date.now() - start < POLL_TIMEOUT) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL));
          try {
            const pollRes = await axios.get(
              `${SCRAPER_API}/task/${taskId}`,
              { timeout: 10_000 },
            );
            if (pollRes.data?.status === 'done') {
              result = pollRes.data;
              break;
            }
          } catch {
            // poll error — keep trying
          }
        }
      }

      // Done — remove from queue
      discoverQueueRef.current.shift();
      setDiscoverQueue([...discoverQueueRef.current]);

      if (result?.success) {
        const name = result?.product?.name ?? barcode;
        const productId = result?.grocy_id ?? result?.product?.id;
        const wasNew = !result?.already_existed;
        const extraCount = discoverPendingCountsRef.current[barcode] ?? 0;
        const recentsCount = pendingShoppingRecentsRef.current[barcode] ?? 0;
        delete discoverPendingCountsRef.current[barcode];
        delete pendingShoppingRecentsRef.current[barcode];
        if (extraCount > 0 && productId) {
          try {
            await axios.post(`${API_BASE}/stock/add`, {
              product_id: productId,
              amount: extraCount,
            });
          } catch {
            // non-fatal — best-effort
          }
          addToast(`Discovered: ${name} (+${extraCount} more added)`, 'success');
        } else {
          addToast(`Discovered: ${name}`, 'success');
        }

        // Credit shopping-mode recents for the trigger scan plus any extras
        // that arrived while discovery was in flight. The synthesised entry
        // has no picture; a later rescan of the now-known product fills it in.
        if (recentsCount > 0 && productId) {
          pushRecent(
            setShoppingRecents,
            { id: productId, name, picture_filename: null },
            recentsCount,
          );
        }

        // Fulfill any pending shopping-list adds for this barcode.
        const pendingShop = pendingShoppingAddsRef.current[barcode] ?? 0;
        delete pendingShoppingAddsRef.current[barcode];
        if (pendingShop > 0 && productId) {
          try {
            await axios.post(`${API_BASE}/shopping-list`, {
              product_id: productId,
              amount: pendingShop,
            });
            addToast(`🛒 ${name} added to shopping list`, 'success');
          } catch (err) {
            addToast(
              err?.response?.data?.detail ?? 'Failed to add to shopping list.',
              'error',
            );
          }
        }

        // Newly-discovered products: ask HA-Storage's AI optimizer to fill in
        // group / location / unit / parent / etc. Skipped if the barcode
        // already mapped to an existing product.
        if (wasNew && productId) triggerAiOptimize(productId);
      } else if (result?.status === 'running') {
        delete discoverPendingCountsRef.current[barcode];
        delete pendingShoppingAddsRef.current[barcode];
        delete pendingShoppingRecentsRef.current[barcode];
        addToast(`Lookup timed out for ${barcode}. Check scraper logs.`, 'error');
      } else {
        delete discoverPendingCountsRef.current[barcode];
        delete pendingShoppingAddsRef.current[barcode];
        delete pendingShoppingRecentsRef.current[barcode];
        addToast(
          result?.error ?? `Product not found online (${barcode}).`,
          'error',
        );
      }
    } catch (discoverErr) {
      if (discoverErr?.response?.status === 409) {
        // Server busy with another operation — retry after delay
        addToast('Scraper busy — retrying queued lookup…', 'info');
        isDiscoveringRef.current = false;
        await new Promise((r) => setTimeout(r, DISCOVER_RETRY_DELAY_MS));
        processDiscoverQueue();
        return;
      }
      // Network error or other failure — drop this barcode and move on
      discoverQueueRef.current.shift();
      setDiscoverQueue([...discoverQueueRef.current]);
      delete discoverPendingCountsRef.current[barcode];
      delete pendingShoppingAddsRef.current[barcode];
      delete pendingShoppingRecentsRef.current[barcode];
      addToast('Could not reach scraper.', 'error');
    } finally {
      isDiscoveringRef.current = false;
    }

    // Process the next item, if any
    if (discoverQueueRef.current.length > 0) {
      processDiscoverQueue();
    } else {
      // Queue drained — refresh stock to show any newly discovered products
      refreshStock();
    }
  }, [addToast, refreshStock, pushRecent, triggerAiOptimize]);

  // ---- Barcode scan handler ------------------------------------------------
  // Called for each barcode scan (single or continuous mode).
  // Checks Storage FIRST to decide how to handle the barcode:
  //   - Known product → add stock via Storage API
  //   - Unknown + scraper available → enqueue discover
  //   - Unknown + no scraper → queue barcode for later pickup
  //   - Storage check failed → queue barcode for later pickup
  const handleBarcodeScan = useCallback(
    async (barcode, { continuous = false } = {}) => {
      // If barcode is already queued for discovery, accumulate extra count
      // so we can add those units to stock once the product is found.
      if (discoverQueueRef.current.includes(barcode)) {
        discoverPendingCountsRef.current[barcode] =
          (discoverPendingCountsRef.current[barcode] ?? 0) + 1;
        if (continuous) {
          pendingShoppingRecentsRef.current[barcode] =
            (pendingShoppingRecentsRef.current[barcode] ?? 0) + 1;
        }
        const total = 1 + discoverPendingCountsRef.current[barcode];
        addToast(`Still looking up — will add ×${total} when found`, 'info');
        return;
      }

      const now = Date.now();
      if (
        barcode === lastScanBarcodeRef.current &&
        now - lastScanTimeRef.current < SCAN_COOLDOWN_MS
      ) {
        addToast('Already scanned — wait a moment', 'info');
        return;
      }
      lastScanTimeRef.current = now;
      lastScanBarcodeRef.current = barcode;
      if (!continuous) {
        setShowScanner(false);
      }

      // Step 1: Check Storage for the barcode
      let productKnown = false;
      let storageCheckFailed = false;
      let foundProduct = null;
      try {
        const resp = await axios.get(`${API_BASE}/products/by-barcode/${encodeURIComponent(barcode)}`);
        productKnown = true;
        foundProduct = resp.data;
      } catch (lookupErr) {
        if (lookupErr?.response?.status === 400 || lookupErr?.response?.status === 404) {
          productKnown = false;
        } else {
          storageCheckFailed = true;
        }
      }

      // Step 2: Route based on result
      if (!productKnown && scraperAvailable && !storageCheckFailed) {
        // Unknown product + scraper available → enqueue discover
        if (!discoverQueueRef.current.includes(barcode)) {
          discoverQueueRef.current.push(barcode);
          setDiscoverQueue([...discoverQueueRef.current]);
        }
        if (continuous) {
          pendingShoppingRecentsRef.current[barcode] =
            (pendingShoppingRecentsRef.current[barcode] ?? 0) + 1;
        }
        addToast(`Looking up new product… (${discoverQueueRef.current.length} in queue)`, 'info');
        processDiscoverQueue();
      } else if (productKnown && foundProduct) {
        // Known product → add 1 to stock via Storage API
        try {
          await axios.post(`${API_BASE}/stock/add`, {
            product_id: foundProduct.id,
            amount: foundProduct.matched_pack_size ?? 1,
          });
          const packLabel = (foundProduct.matched_pack_size ?? 1) > 1
            ? ` (+${foundProduct.matched_pack_size})`
            : '';
          addToast(
            `Scanned: ${foundProduct.name ?? barcode}${packLabel}`,
            'success',
          );
          if (continuous) pushRecent(setShoppingRecents, foundProduct);
        } catch (err) {
          addToast(
            err?.response?.data?.detail ?? 'Failed to add stock for scanned barcode.',
            'error',
          );
        }
      } else {
        // Unknown + no scraper, or storage unreachable → queue barcode
        try {
          await axios.post(`${API_BASE}/barcode-queue`, {
            barcode,
            source: 'stock-scan',
          });
          addToast('Barcode queued for lookup', 'info');
        } catch (err) {
          addToast(
            err?.response?.data?.detail ?? 'Failed to queue barcode.',
            'error',
          );
        }
      }

      // In single-scan mode, refresh stock immediately.
      // In continuous mode, stock is refreshed when the queue drains.
      if (!continuous) {
        await refreshStock();
      }
    },
    [addToast, refreshStock, scraperAvailable, processDiscoverQueue, pushRecent],
  );

  // ---- Scanner close handler -----------------------------------------------
  // Called when the scanner is cancelled or the user presses Finish.
  // If discovers are still queued they keep processing in the background;
  // processDiscoverQueue refreshes stock when the queue drains.
  const handleScannerClose = useCallback(
    async ({ scanned = 0 } = {}) => {
      setShowScanner(false);
      setShoppingRecents([]);
      if (scanned > 0 && discoverQueueRef.current.length === 0) {
        await refreshStock();
      }
      // After a shopping-mode session with at least one scan, ask who did
      // the shopping / scanning so HA-chores can credit XP and skip the
      // duplicate "Unpack & scan" follow-up.
      if (scanned > 0) {
        setShoppingAttribution({ scanCount: scanned });
      }
    },
    [refreshStock],
  );

  // ---- Inventory scanner handlers ------------------------------------------
  // Accumulates per-product counts without touching stock immediately.
  const handleInventoryBarcodeScan = useCallback(
    async (barcode, { continuous = false } = {}) => {
      const now = Date.now();
      if (
        barcode === invLastBarcodeRef.current &&
        now - invLastTimeRef.current < SCAN_COOLDOWN_MS
      ) {
        addToast('Already scanned — wait a moment', 'info');
        return;
      }
      invLastTimeRef.current = now;
      invLastBarcodeRef.current = barcode;

      // Look up the barcode in Storage
      let productKnown = false;
      let foundProduct = null;
      let storageCheckFailed = false;
      try {
        const resp = await axios.get(`${API_BASE}/products/by-barcode/${encodeURIComponent(barcode)}`);
        productKnown = true;
        foundProduct = resp.data;
      } catch (lookupErr) {
        if (lookupErr?.response?.status === 400 || lookupErr?.response?.status === 404) {
          productKnown = false;
        } else {
          storageCheckFailed = true;
        }
      }

      if (!productKnown && scraperAvailable && !storageCheckFailed) {
        // Unknown product — enqueue discover so it becomes available on next scan
        if (!discoverQueueRef.current.includes(barcode)) {
          discoverQueueRef.current.push(barcode);
          setDiscoverQueue([...discoverQueueRef.current]);
        }
        addToast(`Looking up new product… (${discoverQueueRef.current.length} in queue)`, 'info');
        processDiscoverQueue();
      } else if (productKnown && foundProduct) {
        const pid = foundProduct.id;
        const name = foundProduct.name ?? barcode;
        inventoryCountsRef.current[pid] = (inventoryCountsRef.current[pid] ?? 0) + 1;
        inventoryNamesRef.current[pid] = name;
        setInventoryCounts({ ...inventoryCountsRef.current });
        addToast(`📋 ${name} × ${inventoryCountsRef.current[pid]}`, 'success');
        pushRecent(setInventoryRecents, foundProduct);
      } else {
        try {
          await axios.post(`${API_BASE}/barcode-queue`, { barcode, source: 'inventory-scan' });
          addToast('Barcode queued for lookup', 'info');
        } catch {
          addToast('Failed to queue barcode.', 'error');
        }
      }
    },
    [addToast, scraperAvailable, processDiscoverQueue, pushRecent],
  );

  // Commits inventory deltas to Storage when the user presses Finish.
  const handleInventoryClose = useCallback(
    async ({ scanned = 0 } = {}) => {
      setShowInventoryScanner(false);
      const counts = inventoryCountsRef.current;
      const countedPids = new Set(Object.keys(counts).map(Number));

      if (scanned > 0) {
        // Build a quick lookup of current stock by product_id
        const currentStock = {};
        for (const item of stockItems) {
          currentStock[item.product_id] = item.amount ?? 0;
        }

        const adjustments = [];
        for (const [pidStr, counted] of Object.entries(counts)) {
          const pid = Number(pidStr);
          const current = currentStock[pid] ?? 0;
          const delta = counted - current;
          if (delta > 0) {
            adjustments.push(axios.post(`${API_BASE}/stock/add`, { product_id: pid, amount: delta }));
          } else if (delta < 0) {
            adjustments.push(axios.post(`${API_BASE}/stock/consume`, { product_id: pid, amount: -delta }));
          }
        }

        if (adjustments.length > 0) {
          try {
            await Promise.all(adjustments);
            addToast(`Inventory committed — ${adjustments.length} product(s) adjusted`, 'success');
          } catch (err) {
            addToast(err?.response?.data?.detail ?? 'Failed to commit inventory adjustments.', 'error');
          }
        } else {
          addToast('Inventory complete — no adjustments needed', 'info');
        }
      }

      // Trigger incremental optimize for products in stock that weren't scanned
      const unscannedInStock = stockItems.some((item) => !countedPids.has(item.product_id));
      if (unscannedInStock && scraperAvailable) {
        try {
          await axios.post(`${SCRAPER_API}/optimize`, { incremental: true });
          addToast('Running incremental optimize for unscanned products…', 'info');
        } catch {
          // Non-fatal — optimizer may already be running
        }
      }

      // Reset inventory state
      inventoryCountsRef.current = {};
      inventoryNamesRef.current = {};
      setInventoryCounts({});
      setInventoryRecents([]);
      invLastBarcodeRef.current = null;
      invLastTimeRef.current = 0;

      await refreshStock();
    },
    [addToast, refreshStock, scraperAvailable, stockItems],
  );

  // ---- Shopping-list scan handler (single-fire) ----------------------------
  // Looks up the barcode; if known, posts to /shopping-list. If unknown and
  // scraper is available, enqueues discover and schedules the shopping-list
  // add to fire when the discovered product lands. Closes the scanner after
  // the first scan in either case.
  const handleShoppingListBarcodeScan = useCallback(
    async (barcode) => {
      setShowShoppingListScanner(false);

      let productKnown = false;
      let foundProduct = null;
      let storageCheckFailed = false;
      try {
        const resp = await axios.get(
          `${API_BASE}/products/by-barcode/${encodeURIComponent(barcode)}`,
        );
        productKnown = true;
        foundProduct = resp.data;
      } catch (lookupErr) {
        if (
          lookupErr?.response?.status === 400 ||
          lookupErr?.response?.status === 404
        ) {
          productKnown = false;
        } else {
          storageCheckFailed = true;
        }
      }

      if (productKnown && foundProduct) {
        try {
          await axios.post(`${API_BASE}/shopping-list`, {
            product_id: foundProduct.id,
            amount: 1,
          });
          addToast(
            `🛒 ${foundProduct.name ?? barcode} added to shopping list`,
            'success',
          );
        } catch (err) {
          addToast(
            err?.response?.data?.detail ?? 'Failed to add to shopping list.',
            'error',
          );
        }
        return;
      }

      if (!storageCheckFailed && scraperAvailable) {
        pendingShoppingAddsRef.current[barcode] =
          (pendingShoppingAddsRef.current[barcode] ?? 0) + 1;
        if (!discoverQueueRef.current.includes(barcode)) {
          discoverQueueRef.current.push(barcode);
          setDiscoverQueue([...discoverQueueRef.current]);
        }
        addToast(
          `Looking up new product… will add to shopping list when found`,
          'info',
        );
        processDiscoverQueue();
        return;
      }

      try {
        await axios.post(`${API_BASE}/barcode-queue`, {
          barcode,
          source: 'shopping-list-scan',
        });
        addToast('Barcode queued for lookup', 'info');
      } catch (err) {
        addToast(
          err?.response?.data?.detail ?? 'Failed to queue barcode.',
          'error',
        );
      }
    },
    [addToast, scraperAvailable, processDiscoverQueue],
  );

  const handleShoppingListClose = useCallback(() => {
    setShowShoppingListScanner(false);
  }, []);

  // ---- Recents adjust (swipe to fix mistakes) ------------------------------
  // Shopping continuous: each swipe adjusts stock by one pack-size unit and
  // updates the recents count. Inventory continuous: each swipe bumps the
  // local inventory counter and recents count; the actual stock delta is
  // committed when the user presses Finish.
  const handleAdjustShoppingRecent = useCallback(
    async (recent, delta) => {
      const amount = (recent.packSize ?? 1) * (delta > 0 ? 1 : -1);
      try {
        if (delta > 0) {
          await axios.post(`${API_BASE}/stock/add`, {
            product_id: recent.id,
            amount: Math.abs(amount),
          });
          addToast(`+${Math.abs(amount)} ${recent.name}`, 'success');
        } else {
          await axios.post(`${API_BASE}/stock/consume`, {
            product_id: recent.id,
            amount: Math.abs(amount),
          });
          addToast(`−${Math.abs(amount)} ${recent.name}`, 'success');
        }
        adjustRecentCount(setShoppingRecents, recent.id, delta);
      } catch (err) {
        addToast(
          err?.response?.data?.detail ?? 'Failed to adjust stock.',
          'error',
        );
      }
    },
    [addToast, adjustRecentCount],
  );

  const handleAdjustInventoryRecent = useCallback(
    (recent, delta) => {
      const pid = recent.id;
      const current = inventoryCountsRef.current[pid] ?? 0;
      const next = current + delta;
      if (next <= 0) {
        delete inventoryCountsRef.current[pid];
        delete inventoryNamesRef.current[pid];
      } else {
        inventoryCountsRef.current[pid] = next;
      }
      setInventoryCounts({ ...inventoryCountsRef.current });
      adjustRecentCount(setInventoryRecents, pid, delta);
      addToast(
        delta > 0
          ? `+1 ${recent.name} (${Math.max(next, 0)})`
          : `−1 ${recent.name} (${Math.max(next, 0)})`,
        'success',
      );
    },
    [addToast, adjustRecentCount],
  );

  const handleScanPick = useCallback((mode) => {
    setShowScanPicker(false);
    if (mode === 'shopping') setShowScanner(true);
    else if (mode === 'inventory') setShowInventoryScanner(true);
    else if (mode === 'shopping-list') setShowShoppingListScanner(true);
  }, []);

  // ---- Shopping-list mutation handlers ------------------------------------
  // All mutations are optimistic: state updates first, server call follows,
  // and we roll back + toast on error. Mirrors the consume/keep patterns used
  // elsewhere in this file.

  const handleAddProductToShoppingList = useCallback(
    async (product, { amount = 1, note = '' } = {}) => {
      if (!product?.id) return;
      pendingMutations.current++;
      const tempId = -Date.now();
      const optimistic = {
        id: tempId,
        product_id: product.id,
        amount,
        unit_id: null,
        note,
        done: false,
        recipe_id: null,
        auto_added: false,
        ha_item_name: product.name ?? null,
        created_at: new Date().toISOString(),
      };
      setShoppingList((prev) => [optimistic, ...prev]);
      try {
        const resp = await axios.post(`${API_BASE}/shopping-list`, {
          product_id: product.id,
          amount,
          note,
        });
        const real = resp.data;
        setShoppingList((prev) =>
          prev.map((row) =>
            row.id === tempId
              ? { ...real, amount: parseFloat(real.amount ?? 1), done: !!real.done }
              : row,
          ),
        );
        try { navigator.vibrate?.(30); } catch {}
        addToast(`🛒 ${product.name ?? 'Tuote'} listalle`, 'success');
      } catch (err) {
        setShoppingList((prev) => prev.filter((row) => row.id !== tempId));
        addToast(
          err?.response?.data?.detail ?? 'Lisäys epäonnistui.',
          'error',
        );
      } finally {
        pendingMutations.current = Math.max(0, pendingMutations.current - 1);
      }
    },
    [addToast],
  );

  // Wrapper that adds the currently-selected product (from ProductDetailOverlay)
  // to the shopping list and shows a confirmation toast.
  const handleAddSelectedToShopping = useCallback(() => {
    const product = selectedItem?.product;
    if (!product) return;
    handleAddProductToShoppingList(product, { amount: 1 });
  }, [selectedItem, handleAddProductToShoppingList]);

  const handleAddEanToShoppingList = useCallback(
    async (scraperProduct) => {
      if (!scraperProduct) return;
      const ean = (scraperProduct.ean || '').trim();
      const name = scraperProduct.name || 'Tuote';

      // Shopping-list adds must NEVER route through the scraper's discover
      // pipeline: that flow's `_discover_single_barcode` always adds +1 to
      // stock, which is correct for inventory scans but wrong for putting an
      // item on the shopping list. Instead we use the scraper's
      // `/api/add_products` endpoint, which performs a *partial* enrichment:
      //   - creates the product with name + description
      //   - attaches the barcode
      //   - uploads the picture
      //   - does NOT add stock and does NOT run AI categorisation
      // After the product exists we kick off HA-Storage's AI optimizer
      // (POST /api/storage/ai/optimize) directly — that's the maintained
      // pipeline (3 phases, streaming logs, single-flight lock).
      // Falls back to a bare-bones direct create if the scraper is offline.
      pendingMutations.current++;
      if (scraperAvailable) {
        addToast(`🔎 Lisätään: ${name}…`, 'info');
      }
      try {
        let createdProduct = null;

        if (scraperAvailable) {
          const post = await axios.post(
            `${SCRAPER_API}/add_products`,
            {
              products: [
                {
                  name,
                  ean,
                  description: scraperProduct.description || '',
                  image_url: scraperProduct.image_url || '',
                },
              ],
            },
            { timeout: 15_000 },
          );

          let result = post.data;
          if (result?.task_id) {
            const taskId = result.task_id;
            const deadline = Date.now() + 120_000;
            const POLL_INTERVAL = 800;
            // Poll the scraper task until it settles. add_products triggers
            // image upload + (optionally) Gemini categorisation, both of which
            // can take a few seconds, so the deadline is generous.
            // eslint-disable-next-line no-await-in-loop
            while (Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, POLL_INTERVAL));
              try {
                const r = await axios.get(
                  `${SCRAPER_API}/task/${taskId}`,
                  { timeout: 10_000 },
                );
                const status = r.data?.status;
                if (
                  status === 'done' ||
                  status === 'completed' ||
                  status === 'success'
                ) {
                  result = r.data;
                  break;
                }
                if (status === 'error' || status === 'failed') {
                  throw new Error(r.data?.error ?? 'Tuotteen luonti epäonnistui.');
                }
              } catch (err) {
                if (err?.response?.status !== 404) throw err;
                // 404 = task already pruned; treat as still-running.
              }
            }
            if (result?.task_id && result?.status !== 'done') {
              throw new Error('Aikakatkaisu');
            }
          }

          if (result && result.success === false) {
            throw new Error(
              (Array.isArray(result.errors) && result.errors[0]) ||
                result.error ||
                'Tuotteen luonti epäonnistui.',
            );
          }

          // Resolve the freshly-created product. Prefer barcode lookup, then
          // fall back to a /products refresh + name match.
          if (ean) {
            try {
              const r = await axios.get(
                `${API_BASE}/products/by-barcode/${encodeURIComponent(ean)}`,
              );
              createdProduct = r.data;
            } catch {
              // fall through to name lookup
            }
          }
          if (!createdProduct) {
            try {
              const r = await axios.get(`${API_BASE}/products`);
              const list = Array.isArray(r.data) ? r.data : [];
              setAllProducts(list);
              const lower = name.toLowerCase();
              createdProduct =
                list.find((p) => p.name === name) ??
                list.find((p) => (p.name || '').toLowerCase() === lower) ??
                null;
            } catch {
              // ignored — handled below
            }
          }
        }

        // Scraper unavailable, or scraper succeeded but lookup failed → bare
        // create as a last-resort fallback so the user still gets a row on the
        // list.
        if (!createdProduct) {
          const newProd = await axios.post(`${API_BASE}/products`, {
            name,
            description: scraperProduct.description || '',
            unit_id: 1,
          });
          createdProduct = newProd.data;
          if (ean && createdProduct?.id) {
            try {
              await axios.post(`${API_BASE}/barcodes`, {
                product_id: createdProduct.id,
                barcode: ean,
              });
            } catch {
              // Non-fatal: missing barcode just means future scans won't
              // auto-link, but the shopping-list entry still works.
            }
          }
        }

        await handleAddProductToShoppingList(createdProduct);

        // After the product exists, ask HA-Storage to enrich it (group,
        // location, unit, parent, best-before, pack quantity, etc.).
        if (createdProduct?.id) triggerAiOptimize(createdProduct.id);
      } catch (err) {
        addToast(
          err?.response?.data?.detail ?? err?.message ?? 'Lisäys epäonnistui.',
          'error',
        );
      } finally {
        pendingMutations.current = Math.max(0, pendingMutations.current - 1);
      }
    },
    [addToast, handleAddProductToShoppingList, scraperAvailable, triggerAiOptimize],
  );

  // Lazy create-or-fetch of the "Muistilappu" sentinel product used to back
  // free-text shopping-list rows. Cached for the session.
  const ensureNoteSentinel = useCallback(async () => {
    if (noteSentinelIdRef.current != null) return noteSentinelIdRef.current;
    // Look in the loaded products list first
    const existing = (allProducts || []).find((p) => p.name === NOTE_SENTINEL_NAME);
    if (existing) {
      noteSentinelIdRef.current = existing.id;
      return existing.id;
    }
    // Otherwise create it
    const resp = await axios.post(`${API_BASE}/products`, {
      name: NOTE_SENTINEL_NAME,
      description: 'Vapaa teksti ostoslistalla',
      unit_id: 1,
    });
    const id = resp.data?.id;
    if (id != null) noteSentinelIdRef.current = id;
    return id;
  }, [allProducts]);

  const handleAddNoteToShoppingList = useCallback(
    async (text) => {
      const note = String(text || '').trim();
      if (!note) return;
      try {
        const id = await ensureNoteSentinel();
        if (id == null) throw new Error('No sentinel');
        await handleAddProductToShoppingList(
          { id, name: note },
          { amount: 1, note },
        );
      } catch (err) {
        addToast(
          err?.response?.data?.detail ?? 'Muistilapun lisäys epäonnistui.',
          'error',
        );
      }
    },
    [ensureNoteSentinel, handleAddProductToShoppingList, addToast],
  );

  const handleToggleShoppingDone = useCallback(
    async (item) => {
      if (!item?.id || item.id < 0) return; // ignore optimistic-only ids
      const next = !item.done;
      pendingMutations.current++;
      setShoppingList((prev) =>
        prev.map((row) => (row.id === item.id ? { ...row, done: next } : row)),
      );
      try {
        await axios.put(`${API_BASE}/shopping-list/${item.id}`, { done: next });
      } catch (err) {
        setShoppingList((prev) =>
          prev.map((row) =>
            row.id === item.id ? { ...row, done: item.done } : row,
          ),
        );
        addToast(
          err?.response?.data?.detail ?? 'Päivitys epäonnistui.',
          'error',
        );
      } finally {
        pendingMutations.current = Math.max(0, pendingMutations.current - 1);
      }
    },
    [addToast],
  );

  const handleUpdateShoppingAmount = useCallback(
    async (item, newAmount) => {
      if (!item?.id || item.id < 0) return;
      const safe = Math.max(0.1, parseFloat(newAmount) || 1);
      pendingMutations.current++;
      const prevAmount = item.amount;
      setShoppingList((prev) =>
        prev.map((row) => (row.id === item.id ? { ...row, amount: safe } : row)),
      );
      try {
        await axios.put(`${API_BASE}/shopping-list/${item.id}`, { amount: safe });
      } catch (err) {
        setShoppingList((prev) =>
          prev.map((row) =>
            row.id === item.id ? { ...row, amount: prevAmount } : row,
          ),
        );
        addToast(
          err?.response?.data?.detail ?? 'Päivitys epäonnistui.',
          'error',
        );
      } finally {
        pendingMutations.current = Math.max(0, pendingMutations.current - 1);
      }
    },
    [addToast],
  );

  const handleDeleteShoppingItem = useCallback(
    async (item) => {
      if (!item?.id || item.id < 0) return;
      pendingMutations.current++;
      const removed = item;
      setShoppingList((prev) => prev.filter((row) => row.id !== item.id));
      try {
        await axios.delete(`${API_BASE}/shopping-list/${item.id}`);
      } catch (err) {
        setShoppingList((prev) => [removed, ...prev]);
        addToast(
          err?.response?.data?.detail ?? 'Poisto epäonnistui.',
          'error',
        );
      } finally {
        pendingMutations.current = Math.max(0, pendingMutations.current - 1);
      }
    },
    [addToast],
  );

  const handleClearDoneShopping = useCallback(async () => {
    const doneItems = shoppingList.filter((row) => row.done);
    if (doneItems.length === 0) return;
    pendingMutations.current++;
    setShoppingList((prev) => prev.filter((row) => !row.done));
    try {
      await axios.delete(`${API_BASE}/shopping-list/done`);
      addToast(`Tyhjennetty: ${doneItems.length} valmista`, 'success');
    } catch (err) {
      // Roll back by re-adding the cleared items
      setShoppingList((prev) => [...doneItems, ...prev]);
      addToast(
        err?.response?.data?.detail ?? 'Tyhjennys epäonnistui.',
        'error',
      );
    } finally {
      pendingMutations.current = Math.max(0, pendingMutations.current - 1);
    }
  }, [shoppingList, addToast]);

  // Swap a parent-product row to one of its children. Backend doesn't allow
  // changing product_id via PUT, so we delete + re-create as one optimistic
  // operation.
  const handleSwapToChild = useCallback(
    async (item, child) => {
      if (!item?.id || !child?.id) return;
      pendingMutations.current++;
      const original = item;
      const tempId = -Date.now();
      const optimistic = {
        ...item,
        id: tempId,
        product_id: child.id,
        ha_item_name: child.name,
      };
      setShoppingList((prev) =>
        prev.map((row) => (row.id === item.id ? optimistic : row)),
      );
      try {
        const [, createRes] = await Promise.all([
          axios.delete(`${API_BASE}/shopping-list/${item.id}`),
          axios.post(`${API_BASE}/shopping-list`, {
            product_id: child.id,
            amount: item.amount ?? 1,
            note: item.note ?? '',
          }),
        ]);
        const real = createRes.data;
        setShoppingList((prev) =>
          prev.map((row) =>
            row.id === tempId
              ? { ...real, amount: parseFloat(real.amount ?? 1), done: !!real.done }
              : row,
          ),
        );
        try { navigator.vibrate?.(30); } catch {}
        addToast(`Vaihdettu: ${child.name}`, 'success');
      } catch (err) {
        setShoppingList((prev) =>
          prev.map((row) => (row.id === tempId ? original : row)),
        );
        addToast(
          err?.response?.data?.detail ?? 'Vaihto epäonnistui.',
          'error',
        );
      } finally {
        pendingMutations.current = Math.max(0, pendingMutations.current - 1);
      }
    },
    [addToast],
  );

  // Count of un-done shopping-list items, surfaced in the header badge.
  const shoppingPendingCount = useMemo(
    () => (shoppingList || []).filter((row) => !row.done).length,
    [shoppingList],
  );

  // ---- Pending consume refs (for undo) ------------------------------------
  const pendingConsumes = useRef({});

  // Clean up pending consume timeouts on unmount
  useEffect(() => {
    const pending = pendingConsumes.current;
    return () => {
      Object.values(pending).forEach(clearTimeout);
    };
  }, []);

  // ---- Consume (optimistic UI update with undo) ---------------------------
  const handleConsume = useCallback(
    (productId) => {
      // Find the product name for the toast message
      const product = stockItems.find((i) => i.product_id === productId);
      const productName = product?.product?.name ?? 'item';

      // Keep a reference to the original item in case we need to re-add it
      const originalItem = product ? { ...product } : null;

      // Guard background sync while this mutation is in-flight
      pendingMutations.current++;
      let mutationFinalized = false;

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

      // --- Toast with undo ---
      const toastId = Date.now() + Math.random();

      const removeToast = () => {
        setToasts((prev) => prev.filter((t) => t.id !== toastId));
      };

      const undoConsume = () => {
        // Cancel the pending API call
        if (pendingConsumes.current[toastId]) {
          clearTimeout(pendingConsumes.current[toastId]);
          delete pendingConsumes.current[toastId];
        }
        if (!mutationFinalized) {
          mutationFinalized = true;
          pendingMutations.current--;
        }
        // Re-add / increment the product
        setStockItems((prev) => {
          const existing = prev.find((i) => i.product_id === productId);
          if (existing) {
            return prev.map((i) =>
              i.product_id === productId
                ? { ...i, amount: i.amount + 1 }
                : i,
            );
          }
          // Item was removed (amount hit zero) – re-add it
          if (originalItem) {
            return [...prev, { ...originalItem, amount: 1 }];
          }
          return prev;
        });
        removeToast();
      };

      setToasts((prev) => [
        ...prev,
        {
          id: toastId,
          message: `Consumed 1 × ${productName}`,
          type: 'undo',
          onUndo: undoConsume,
        },
      ]);

      // Auto-dismiss toast after 5 seconds
      const dismissTimer = setTimeout(removeToast, 5000);

      // Delay the actual API call for 5 seconds (allows undo)
      pendingConsumes.current[toastId] = setTimeout(async () => {
        delete pendingConsumes.current[toastId];
        try {
          await axios.post(
            `${API_BASE}/stock/consume`,
            { product_id: productId, amount: 1 },
          );
        } catch (err) {
          // Rollback on failure
          setStockItems((prev) => {
            const existing = prev.find((i) => i.product_id === productId);
            if (existing) {
              return prev.map((i) =>
                i.product_id === productId
                  ? { ...i, amount: i.amount + 1 }
                  : i,
              );
            }
            if (originalItem) {
              return [...prev, { ...originalItem, amount: 1 }];
            }
            return prev;
          });
          addToast(
            err?.response?.data?.detail_message ??
              'Failed to consume item. Please try again.',
            'error',
          );
        } finally {
          if (!mutationFinalized) {
            mutationFinalized = true;
            pendingMutations.current--;
          }
        }
      }, 5000);
    },
    [stockItems, addToast],
  );

  // ---- Overlay handlers ---------------------------------------------------
  const overlayOpenTimeRef = useRef(0);

  const handleItemClick = useCallback(
    (productId) => {
      overlayOpenTimeRef.current = Date.now();
      setSelectedProductId(productId);
    },
    [],
  );

  const handleCloseOverlay = useCallback(
    () => {
      // Reject close within 500ms of opening — prevents a phantom synthetic
      // click from immediately closing the overlay before the user sees it.
      if (Date.now() - overlayOpenTimeRef.current < 500) return;
      setSelectedProductId(null);
    },
    [],
  );

  // ---- Helper: set min_stock on a single product ---------------------------
  const setMinStock = useCallback(async (productId, newMin, rollbackMin) => {
    pendingMutations.current++;
    setStockItems((prev) =>
      prev.map((item) =>
        item.product_id === productId
          ? { ...item, product: { ...item.product, min_stock_amount: newMin } }
          : item,
      ),
    );
    try {
      await axios.put(`${API_BASE}/products/${productId}`, {
        min_stock_amount: newMin,
      });
      return true;
    } catch (err) {
      setStockItems((prev) =>
        prev.map((item) =>
          item.product_id === productId
            ? {
                ...item,
                product: { ...item.product, min_stock_amount: rollbackMin },
              }
            : item,
        ),
      );
      addToast(
        err?.response?.data?.detail_message ?? 'Failed to update product.',
        'error',
      );
      return false;
    } finally {
      pendingMutations.current--;
    }
  }, [addToast]);

  const handleToggleKeepInStock = useCallback(async () => {
    if (!selectedItem) return;
    const productId = selectedItem.product_id;
    const currentMin = parseFloat(selectedItem.product?.min_stock_amount ?? 0);
    const parentId = selectedItem.product?.parent_id;

    // "Do not keep" — just clear min_stock, never re-attach parent.
    if (currentMin >= 1) {
      const ok = await setMinStock(productId, 0, currentMin);
      if (ok) addToast('Removed from keep in stock', 'success');
      return;
    }

    // Parent is already kept in stock → offer to stop or keep this as well.
    if (parentId && parentProduct && parseFloat(parentProduct.min_stock_amount ?? 0) >= 1) {
      setKeepDialog({
        mode: 'parent_kept',
        productId,
        productName: selectedItem.product?.name ?? 'this product',
        parentId: Number(parentId),
        parentName: parentProduct.name ?? `Product #${parentId}`,
      });
      return;
    }

    // "Keep in stock" on a product WITH a parent → show choice dialog.
    if (parentId) {
      try {
        const parentName = parentProduct?.name ?? (await axios.get(
          `${API_BASE}/products/${parentId}`,
        )).data?.name ?? `Product #${parentId}`;
        setKeepDialog({
          mode: 'choose_parent',
          productId,
          productName: selectedItem.product?.name ?? 'this product',
          parentId: Number(parentId),
          parentName,
        });
      } catch {
        // Can't fetch parent — fall through to simple toggle.
        const ok = await setMinStock(productId, 1, 0);
        if (ok) addToast('Marked as keep in stock', 'success');
      }
      return;
    }

    // No parent — simple toggle.
    const ok = await setMinStock(productId, 1, 0);
    if (ok) addToast('Marked as keep in stock', 'success');
  }, [selectedItem, parentProduct, addToast, setMinStock]);

  // ---- Keep-dialog action handlers -----------------------------------------
  const handleKeepParent = useCallback(async () => {
    if (!keepDialog) return;
    const { parentId } = keepDialog;
    setKeepDialog(null);
    const ok = await setMinStock(parentId, 1, 0);
    if (ok) addToast('Parent product marked as keep in stock', 'success');
  }, [keepDialog, addToast, setMinStock]);

  const handleStopKeepingParent = useCallback(async () => {
    if (!keepDialog) return;
    const { parentId, parentName } = keepDialog;
    setKeepDialog(null);
    const ok = await setMinStock(parentId, 0, 1);
    if (ok) addToast(`Stopped keeping "${parentName}" in stock`, 'success');
  }, [keepDialog, addToast, setMinStock]);

  const handleKeepThisOnly = useCallback(async () => {
    if (!keepDialog) return;
    const { productId, productName } = keepDialog;
    setKeepDialog(null);

    pendingMutations.current++;
    // Optimistic: clear parent_id in local state.
    setStockItems((prev) =>
      prev.map((item) =>
        item.product_id === productId
          ? {
              ...item,
              product: { ...item.product, parent_id: null },
            }
          : item,
      ),
    );

    try {
      // Remove parent first, then set min_stock.
      await axios.put(`${API_BASE}/products/${productId}`, {
        parent_id: null,
      });
      await axios.put(`${API_BASE}/products/${productId}`, {
        min_stock_amount: 1,
      });
      setStockItems((prev) =>
        prev.map((item) =>
          item.product_id === productId
            ? {
                ...item,
                product: { ...item.product, min_stock_amount: 1 },
              }
            : item,
        ),
      );
      addToast(`Keeping "${productName}" in stock (detached from parent)`, 'success');
    } catch (err) {
      addToast(
        err?.response?.data?.detail_message ?? 'Failed to update product.',
        'error',
      );
    } finally {
      pendingMutations.current--;
    }
  }, [keepDialog, addToast]);

  const handleAddStock = useCallback(() => {
    if (!selectedItem) return;
    const productId = selectedItem.product_id;
    const productName = selectedItem.product?.name ?? 'item';

    pendingMutations.current++;
    let mutationFinalized = false;

    setStockItems((prev) =>
      prev.map((item) =>
        item.product_id === productId
          ? { ...item, amount: item.amount + 1 }
          : item,
      ),
    );

    const toastId = Date.now() + Math.random();
    const removeToast = () =>
      setToasts((prev) => prev.filter((t) => t.id !== toastId));

    const undoAdd = () => {
      if (pendingConsumes.current[toastId]) {
        clearTimeout(pendingConsumes.current[toastId]);
        delete pendingConsumes.current[toastId];
      }
      if (!mutationFinalized) { mutationFinalized = true; pendingMutations.current--; }
      setStockItems((prev) =>
        prev.map((item) =>
          item.product_id === productId
            ? { ...item, amount: item.amount - 1 }
            : item,
        ),
      );
      removeToast();
    };

    setToasts((prev) => [
      ...prev,
      { id: toastId, message: `Added 1 × ${productName}`, type: 'undo', onUndo: undoAdd },
    ]);
    setTimeout(removeToast, 5500);

    pendingConsumes.current[toastId] = setTimeout(async () => {
      delete pendingConsumes.current[toastId];
      try {
        await axios.post(`${API_BASE}/stock/add`, {
          product_id: productId,
          amount: 1,
          best_before_date: '2999-12-31',
        });
      } catch (err) {
        setStockItems((prev) =>
          prev.map((item) =>
            item.product_id === productId
              ? { ...item, amount: item.amount - 1 }
              : item,
          ),
        );
        addToast(err?.response?.data?.detail_message ?? 'Failed to add stock.', 'error');
      } finally {
        if (!mutationFinalized) { mutationFinalized = true; pendingMutations.current--; }
      }
    }, 5000);
  }, [selectedItem, addToast]);

  const handleOverlayConsume = useCallback(() => {
    if (!selectedItem || selectedItem.amount <= 0) return;
    const productId = selectedItem.product_id;
    const productName = selectedItem.product?.name ?? 'item';
    const originalItem = { ...selectedItem };

    pendingMutations.current++;
    let mutationFinalized = false;

    setStockItems((prev) =>
      prev
        .map((item) =>
          item.product_id === productId
            ? { ...item, amount: item.amount - 1 }
            : item,
        )
        .filter((item) => item.amount > 0),
    );

    const toastId = Date.now() + Math.random();
    const removeToast = () =>
      setToasts((prev) => prev.filter((t) => t.id !== toastId));

    const undoConsume = () => {
      if (pendingConsumes.current[toastId]) {
        clearTimeout(pendingConsumes.current[toastId]);
        delete pendingConsumes.current[toastId];
      }
      if (!mutationFinalized) { mutationFinalized = true; pendingMutations.current--; }
      setStockItems((prev) => {
        const existing = prev.find((i) => i.product_id === productId);
        if (existing) {
          return prev.map((i) =>
            i.product_id === productId ? { ...i, amount: i.amount + 1 } : i,
          );
        }
        return [...prev, { ...originalItem, amount: 1 }];
      });
      removeToast();
    };

    setToasts((prev) => [
      ...prev,
      { id: toastId, message: `Consumed 1 × ${productName}`, type: 'undo', onUndo: undoConsume },
    ]);
    setTimeout(removeToast, 5500);

    pendingConsumes.current[toastId] = setTimeout(async () => {
      delete pendingConsumes.current[toastId];
      try {
        await axios.post(`${API_BASE}/stock/consume`, { product_id: productId, amount: 1 });
      } catch (err) {
        setStockItems((prev) => {
          const existing = prev.find((i) => i.product_id === productId);
          if (existing) {
            return prev.map((i) =>
              i.product_id === productId ? { ...i, amount: i.amount + 1 } : i,
            );
          }
          return [...prev, { ...originalItem, amount: 1 }];
        });
        addToast(err?.response?.data?.detail_message ?? 'Failed to consume item.', 'error');
      } finally {
        if (!mutationFinalized) { mutationFinalized = true; pendingMutations.current--; }
      }
    }, 5000);
  }, [selectedItem, addToast]);

  const handleConsumeAll = useCallback(() => {
    if (!selectedItem || selectedItem.amount <= 0) return;
    const productId = selectedItem.product_id;
    const productName = selectedItem.product?.name ?? 'item';
    const consumeAmount = selectedItem.amount;
    const originalItem = { ...selectedItem };

    // Optimistic: remove item from stock and close overlay immediately
    setStockItems((prev) =>
      prev.filter((item) => item.product_id !== productId),
    );
    setSelectedProductId(null);

    const toastId = Date.now() + Math.random();
    const dismissToast = () =>
      setToasts((prev) => prev.filter((t) => t.id !== toastId));

    const undoConsumeAll = () => {
      if (pendingConsumes.current[toastId]) {
        clearTimeout(pendingConsumes.current[toastId]);
        delete pendingConsumes.current[toastId];
        pendingMutations.current--;
      }
      setStockItems((prev) => [...prev, originalItem]);
      dismissToast();
    };

    pendingMutations.current++;
    setToasts((prev) => [
      ...prev,
      {
        id: toastId,
        message: `Consumed all ${productName}`,
        type: 'undo',
        onUndo: undoConsumeAll,
      },
    ]);
    setTimeout(dismissToast, 5500);

    pendingConsumes.current[toastId] = setTimeout(async () => {
      delete pendingConsumes.current[toastId];
      try {
        await axios.post(
          `${API_BASE}/stock/consume`,
          { product_id: productId, amount: consumeAmount },
        );
      } catch (err) {
        setStockItems((prev) => [...prev, originalItem]);
        addToast(
          err?.response?.data?.detail_message ?? 'Failed to consume items.',
          'error',
        );
      } finally {
        pendingMutations.current--;
      }
    }, 5000);
  }, [selectedItem, addToast]);

  // ---- Add stock from list (swipe-right gesture) --------------------------
  const handleAddFromList = useCallback(
    (productId) => {
      const product = stockItems.find((i) => i.product_id === productId);
      const productName = product?.product?.name ?? 'item';

      pendingMutations.current++;
      let mutationFinalized = false;

      setStockItems((prev) =>
        prev.map((item) =>
          item.product_id === productId
            ? { ...item, amount: item.amount + 1 }
            : item,
        ),
      );

      const toastId = Date.now() + Math.random();
      const removeToast = () =>
        setToasts((prev) => prev.filter((t) => t.id !== toastId));

      const undoAdd = () => {
        if (pendingConsumes.current[toastId]) {
          clearTimeout(pendingConsumes.current[toastId]);
          delete pendingConsumes.current[toastId];
        }
        if (!mutationFinalized) { mutationFinalized = true; pendingMutations.current--; }
        setStockItems((prev) =>
          prev.map((item) =>
            item.product_id === productId
              ? { ...item, amount: item.amount - 1 }
              : item,
          ),
        );
        removeToast();
      };

      setToasts((prev) => [
        ...prev,
        { id: toastId, message: `Added 1 × ${productName}`, type: 'undo', onUndo: undoAdd },
      ]);
      setTimeout(removeToast, 5500);

      pendingConsumes.current[toastId] = setTimeout(async () => {
        delete pendingConsumes.current[toastId];
        try {
          await axios.post(`${API_BASE}/stock/add`, {
            product_id: productId,
            amount: 1,
            best_before_date: '2999-12-31',
          });
        } catch (err) {
          setStockItems((prev) =>
            prev.map((item) =>
              item.product_id === productId
                ? { ...item, amount: item.amount - 1 }
                : item,
            ),
          );
          addToast(err?.response?.data?.detail_message ?? 'Failed to add stock.', 'error');
        } finally {
          if (!mutationFinalized) { mutationFinalized = true; pendingMutations.current--; }
        }
      }, 5000);
    },
    [stockItems, addToast],
  );

  // ---- Open product (mark as opened) ---------------------------------------
  const handleOpenProduct = useCallback(
    (productId) => {
      const product = stockItems.find((i) => i.product_id === productId);
      const productName = product?.product?.name ?? 'item';

      pendingMutations.current++;
      let mutationFinalized = false;

      setStockItems((prev) =>
        prev.map((item) =>
          item.product_id === productId
            ? { ...item, amount_opened: (item.amount_opened ?? 0) + 1 }
            : item,
        ),
      );

      const toastId = Date.now() + Math.random();
      const removeToast = () =>
        setToasts((prev) => prev.filter((t) => t.id !== toastId));

      const undoOpen = () => {
        if (pendingConsumes.current[toastId]) {
          clearTimeout(pendingConsumes.current[toastId]);
          delete pendingConsumes.current[toastId];
        }
        if (!mutationFinalized) { mutationFinalized = true; pendingMutations.current--; }
        setStockItems((prev) =>
          prev.map((item) =>
            item.product_id === productId
              ? { ...item, amount_opened: Math.max(0, (item.amount_opened ?? 1) - 1) }
              : item,
          ),
        );
        removeToast();
      };

      setToasts((prev) => [
        ...prev,
        { id: toastId, message: `Opened 1 × ${productName}`, type: 'undo', onUndo: undoOpen },
      ]);
      setTimeout(removeToast, 5500);

      pendingConsumes.current[toastId] = setTimeout(async () => {
        delete pendingConsumes.current[toastId];
        try {
          await axios.post(`${API_BASE}/stock/open`, { product_id: productId, amount: 1 });
        } catch (err) {
          setStockItems((prev) =>
            prev.map((item) =>
              item.product_id === productId
                ? { ...item, amount_opened: Math.max(0, (item.amount_opened ?? 1) - 1) }
                : item,
            ),
          );
          addToast(err?.response?.data?.detail_message ?? 'Failed to mark as opened.', 'error');
        } finally {
          if (!mutationFinalized) { mutationFinalized = true; pendingMutations.current--; }
        }
      }, 5000);
    },
    [stockItems, addToast],
  );

  // ---- Open product from overlay ------------------------------------------
  const handleOverlayOpen = useCallback(() => {
    if (!selectedItem || selectedItem.amount <= 0) return;
    handleOpenProduct(selectedItem.product_id);
  }, [selectedItem, handleOpenProduct]);

  // ---- Spoil 1 from the overlay -------------------------------------------
  // Mirrors handleOverlayConsume but flags the consume call as `spoiled: true`
  // so HA-storage records the event as a `spoil` in product history.
  const handleOverlaySpoil = useCallback(() => {
    if (!selectedItem || selectedItem.amount <= 0) return;
    const productId = selectedItem.product_id;
    const productName = selectedItem.product?.name ?? 'item';
    const originalItem = { ...selectedItem };

    pendingMutations.current++;
    let mutationFinalized = false;

    setStockItems((prev) =>
      prev
        .map((item) =>
          item.product_id === productId
            ? { ...item, amount: item.amount - 1 }
            : item,
        )
        .filter((item) => item.amount > 0),
    );

    const toastId = Date.now() + Math.random();
    const removeToast = () =>
      setToasts((prev) => prev.filter((t) => t.id !== toastId));

    const undoSpoil = () => {
      if (pendingConsumes.current[toastId]) {
        clearTimeout(pendingConsumes.current[toastId]);
        delete pendingConsumes.current[toastId];
      }
      if (!mutationFinalized) { mutationFinalized = true; pendingMutations.current--; }
      setStockItems((prev) => {
        const existing = prev.find((i) => i.product_id === productId);
        if (existing) {
          return prev.map((i) =>
            i.product_id === productId ? { ...i, amount: i.amount + 1 } : i,
          );
        }
        return [...prev, { ...originalItem, amount: 1 }];
      });
      removeToast();
    };

    setToasts((prev) => [
      ...prev,
      { id: toastId, message: `Spoiled 1 × ${productName}`, type: 'undo', onUndo: undoSpoil },
    ]);
    setTimeout(removeToast, 5500);

    pendingConsumes.current[toastId] = setTimeout(async () => {
      delete pendingConsumes.current[toastId];
      try {
        await axios.post(`${API_BASE}/stock/consume`, {
          product_id: productId,
          amount: 1,
          spoiled: true,
        });
      } catch (err) {
        setStockItems((prev) => {
          const existing = prev.find((i) => i.product_id === productId);
          if (existing) {
            return prev.map((i) =>
              i.product_id === productId ? { ...i, amount: i.amount + 1 } : i,
            );
          }
          return [...prev, { ...originalItem, amount: 1 }];
        });
        addToast(err?.response?.data?.detail_message ?? 'Failed to mark as spoiled.', 'error');
      } finally {
        if (!mutationFinalized) { mutationFinalized = true; pendingMutations.current--; }
      }
    }, 5000);
  }, [selectedItem, addToast]);

  // ---- Filter stock items by selected location ----------------------------
  const filteredStockItems = selectedLocationId === null
    ? stockItems
    : stockItems.filter(
        (item) => String(item.product?.location_id) === String(selectedLocationId),
      );

  // ---- Only show locations that actually have stock items -----------------
  const usedLocationIds = new Set(
    stockItems.map((item) => String(item.product?.location_id)).filter(Boolean),
  );
  const activeLocations = locations.filter((loc) =>
    usedLocationIds.has(String(loc.id)),
  );

  // ---- Build group map & sorted group IDs ----------------------------------
  const groupMap = Object.fromEntries(productGroups.map((g) => [g.id, g]));

  const grouped = {};
  for (const item of filteredStockItems) {
    const gid = item.product?.product_group_id ?? '__ungrouped__';
    (grouped[gid] ??= []).push(item);
  }

  const sortedGroupIds = (() => {
    const ids = Object.keys(grouped).filter((id) => id !== '__ungrouped__');
    const nameOf = (id) => groupMap[id]?.name ?? '';
    const isFav = (id) => favoriteGroups.has(String(id));
    const favs = ids
      .filter(isFav)
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    const rest = ids
      .filter((id) => !isFav(id))
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    return [
      ...favs,
      ...rest,
      ...(grouped.__ungrouped__ ? ['__ungrouped__'] : []),
    ];
  })();

  // ---- Render --------------------------------------------------------------
  if (storageChecking && !storageReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4" />
          <p className="text-gray-400">Waiting for Storage…</p>
          {healthRetries > 3 && (
            <p className="text-gray-500 text-xs mt-2">Attempt {healthRetries}…</p>
          )}
        </div>
      </div>
    );
  }

  if (!storageReady && !storageChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-2">⚠️ Storage unreachable</p>
          <p className="text-gray-400 text-sm mb-4">
            Could not connect after {healthRetries} attempts.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

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
            Check your Storage URL in the add-on settings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 bg-gray-800 text-white px-4 py-4 shadow-md border-b border-gray-700 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">🥫 Stock</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowShoppingList(true)}
            className="relative px-3 h-10 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-full flex items-center gap-2 text-white text-sm font-semibold shadow transition-colors"
            title="Ostoslista"
            aria-label="Avaa ostoslista"
          >
            <span aria-hidden="true">🛒</span>
            <span className="hidden sm:inline">Ostoslista</span>
            {shoppingPendingCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-brand-orange text-[11px] font-bold flex items-center justify-center">
                {shoppingPendingCount > 99 ? '99+' : shoppingPendingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowScanPicker(true)}
            className="px-4 h-10 bg-brand-cobalt hover:bg-brand-cobalt-400 active:bg-brand-cobalt-600 rounded-full flex items-center gap-2 text-white text-sm font-semibold shadow-lg transition-colors"
            title="Scan"
            aria-label="Scan"
          >
            <span aria-hidden="true">📷</span>
            <span>Scan</span>
          </button>
        </div>
      </header>

      {/* Connection lost banner */}
      {disconnected && (
        <div className="mx-4 mt-2 px-4 py-3 rounded-xl bg-amber-600/90 text-white text-sm font-medium flex items-center justify-between">
          <span>⚠️ Yhteys katkesi — lataa sivu uudelleen</span>
          <button
            onClick={() => window.location.reload()}
            className="ml-3 px-3 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-xs font-semibold transition-colors"
          >
            Lataa uudelleen
          </button>
        </div>
      )}

      {/* ── Location tabs ─────────────────────────────────────────────── */}
      {activeLocations.length > 0 && (
        <nav className="sticky top-[60px] z-10 bg-gray-800 px-2 sm:px-4">
          <div className="max-w-2xl mx-auto flex overflow-x-auto scrollbar-hide pt-2">
            <button
              onClick={() => handleTabClick(null)}
              className={`tab-trapezoid flex-shrink-0 px-8 py-2 text-xs font-bold tracking-wider uppercase transition-colors ${
                selectedLocationId === null
                  ? 'tab-active bg-brand-orange text-white'
                  : 'bg-gray-700/70 text-gray-300 hover:bg-gray-600/80'
              }`}
            >
              All
            </button>
            {activeLocations
              .sort((a, b) => (b.name ?? '').localeCompare(a.name ?? ''))
              .map((loc) => (
                <button
                  key={loc.id}
                  onClick={() => handleTabClick(loc.id)}
                  className={`tab-trapezoid flex-shrink-0 px-8 py-2 text-xs font-bold tracking-wider uppercase transition-colors ${
                    String(selectedLocationId) === String(loc.id)
                      ? 'tab-active bg-brand-orange text-white'
                      : 'bg-gray-700/70 text-gray-300 hover:bg-gray-600/80'
                  }`}
                >
                  {loc.name}
                </button>
              ))}
          </div>
          {/* Green baseline */}
          <div className="h-0.5 bg-brand-orange" />
        </nav>
      )}

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <main className="max-w-2xl mx-auto pt-4 px-2 sm:px-4 space-y-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}>
        {filteredStockItems.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <p className="text-5xl mb-3" aria-hidden="true">📦</p>
            <p className="text-lg">
              {stockItems.length === 0
                ? 'No items currently in stock.'
                : 'No items in this location.'}
            </p>
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
                onAdd={handleAddFromList}
                onOpen={handleOpenProduct}
                onItemClick={handleItemClick}
                forceOpen={allGroupsExpanded}
                forceKey={groupExpandKey}
                isFavorite={favoriteGroups.has(String(gid))}
                onToggleFavorite={
                  gid === '__ungrouped__'
                    ? null
                    : () => toggleFavoriteGroup(gid)
                }
              />
            );
          })
        )}
      </main>

      {/* ── Product detail overlay ─────────────────────────────────── */}
      <ProductDetailOverlay
        item={selectedItem}
        parentProduct={parentProduct}
        onClose={handleCloseOverlay}
        onToggleKeep={handleToggleKeepInStock}
        onAdd={handleAddStock}
        onConsume={handleOverlayConsume}
        onConsumeAll={handleConsumeAll}
        onOpen={handleOverlayOpen}
        onSpoil={handleOverlaySpoil}
        onAddToShopping={handleAddSelectedToShopping}
      />

      {/* ── Keep-in-stock parent choice dialog ─────────────────────── */}
      {keepDialog && (
        <KeepInStockDialog
          mode={keepDialog.mode}
          productName={keepDialog.productName}
          parentName={keepDialog.parentName}
          onKeepParent={handleKeepParent}
          onKeepThis={handleKeepThisOnly}
          onStopKeepingParent={handleStopKeepingParent}
          onClose={() => setKeepDialog(null)}
        />
      )}

      {/* ── Scan picker bottom sheet ───────────────────────────────── */}
      {showScanPicker && (
        <ScanPicker onPick={handleScanPick} onClose={() => setShowScanPicker(false)} />
      )}

      {/* ── Barcode scanner overlay (Scan shopping — continuous) ───── */}
      {showScanner && (
        <BarcodeScanner
          onScan={handleBarcodeScan}
          onClose={handleScannerClose}
          discoverQueueLength={discoverQueue.length}
          mode="continuous"
          title="Scan shopping"
          recents={shoppingRecents}
          onShowAllRecents={() => setShowRecentsSheet(true)}
        />
      )}

      {/* ── Inventory scanner overlay (continuous) ─────────────────── */}
      {showInventoryScanner && (
        <BarcodeScanner
          onScan={handleInventoryBarcodeScan}
          onClose={handleInventoryClose}
          discoverQueueLength={discoverQueue.length}
          mode="continuous"
          title="Inventory"
          recents={inventoryRecents}
          onShowAllRecents={() => setShowRecentsSheet(true)}
        />
      )}

      {/* ── Add-to-shopping-list scanner overlay (single-fire) ─────── */}
      {showShoppingListScanner && (
        <BarcodeScanner
          onScan={handleShoppingListBarcodeScan}
          onClose={handleShoppingListClose}
          discoverQueueLength={discoverQueue.length}
          mode="single"
          title="Add to shopping list"
        />
      )}

      {/* ── Session recents sheet ──────────────────────────────────── */}
      {showRecentsSheet && (
        <SessionRecentsSheet
          recents={showInventoryScanner ? inventoryRecents : shoppingRecents}
          title={showInventoryScanner ? 'Inventory — this session' : 'Scanned this session'}
          onClose={() => setShowRecentsSheet(false)}
          onAdjust={
            showInventoryScanner
              ? handleAdjustInventoryRecent
              : handleAdjustShoppingRecent
          }
        />
      )}

      {/* ── Shopping list overlay ──────────────────────────────────── */}
      {showShoppingList && (
        <ShoppingListOverlay
          list={shoppingList}
          products={allProducts}
          productGroups={productGroups}
          scraperAvailable={scraperAvailable}
          recommendations={shoppingRecommendations}
          onClose={() => setShowShoppingList(false)}
          onToggleDone={handleToggleShoppingDone}
          onUpdateAmount={handleUpdateShoppingAmount}
          onDeleteItem={handleDeleteShoppingItem}
          onClearDone={handleClearDoneShopping}
          onAddByProduct={handleAddProductToShoppingList}
          onAddByEan={handleAddEanToShoppingList}
          onAddNote={handleAddNoteToShoppingList}
          onSwapToChild={handleSwapToChild}
        />
      )}

      {/* ── Shopping attribution modal ─────────────────────────────────── */}
      {shoppingAttribution && (
        <ShoppingAttributionModal
          choresApi={CHORES_API}
          ingressPath={INGRESS_PATH}
          scanCount={shoppingAttribution.scanCount}
          onClose={() => setShoppingAttribution(null)}
          onToast={addToast}
        />
      )}

      {/* ── Toasts ─────────────────────────────────────────────────────── */}
      <Toasts toasts={toasts} />
    </div>
  );
}
