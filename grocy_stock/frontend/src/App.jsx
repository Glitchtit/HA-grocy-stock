import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { Html5Qrcode } from 'html5-qrcode';

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
          {/* Row: Keep in stock | +1 | -1 */}
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
              onClick={onAdd}
              className="w-14 py-3 rounded-xl font-bold text-white text-sm bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 transition-colors disabled:opacity-40"
              disabled={!interactive}
            >
              +1
            </button>
            <button
              onClick={onConsume}
              className="w-14 py-3 rounded-xl font-bold text-white text-sm bg-red-500 hover:bg-red-600 active:bg-red-700 transition-colors disabled:opacity-40"
              disabled={item.amount <= 0 || !interactive}
            >
              −1
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
    phase: 'idle',
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
        // Any touch with minimal movement and phase still idle is a valid tap.
        // Removing the elapsed < 250ms guard: if phase stayed idle, the long-press
        // timer hasn't fired yet (< 400ms), so any dist < 15px touch is a tap.
        if (dist < 15) {
          lastTouchRef.current = Date.now();
          cbRef.current.onItemClick(pid);
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

      // Tap escape — near the bottom of the scroll range the browser's
      // overscroll/rubber-band bounce adds 20-40 px of drift even on a clean
      // tap, causing phase to lock to 'scroll'.  A fixed pixel threshold
      // (dist < 20) fails here.  Instead, check whether the finger lifted
      // inside the row's bounding rectangle: if it did, the user intended a
      // tap regardless of absolute drift.  elapsed < 500 prevents a genuine
      // slow scroll from being misclassified.
      if (s.phase === 'scroll') {
        if (elapsed < 500) {
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

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
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
            ? 'shadow-2xl z-10 ring-2 ring-emerald-400/40 rounded-lg'
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
function ProductGroup({ group, items, onConsume, onAdd, onOpen, onItemClick, forceOpen, forceKey }) {
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
// Uses the phone camera to scan barcodes via html5-qrcode.
// Supports single-scan and continuous modes, camera flip, and duplicate-scan
// protection (waits for a "clear" view before allowing the next scan).
// Falls back to manual barcode entry when camera is unavailable.
// ---------------------------------------------------------------------------
function BarcodeScanner({ onScan, onClose, discoverQueueLength = 0, initialContinuous = false }) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [cameraError, setCameraError] = useState(null);
  const [manualBarcode, setManualBarcode] = useState('');
  const [facingMode, setFacingMode] = useState('environment');
  const [continuous, setContinuous] = useState(initialContinuous);
  const [scanCount, setScanCount] = useState(0);

  // Refs for values accessed inside the scanner callback closure
  const continuousRef = useRef(continuous);
  continuousRef.current = continuous;

  // Duplicate-scan protection: ignore repeated reads of the same barcode
  // until the camera has been "clear" (no barcode visible) for several frames.
  const lastScannedRef = useRef(null);
  const clearFramesRef = useRef(0);

  const isFrontCamera = facingMode === 'user';

  // When using the front camera, request a wake lock so the screen stays at
  // full brightness (the bright-white overlay acts as a light to illuminate
  // the barcode).  Re-request on visibility change since the browser
  // automatically releases the lock when the tab is hidden.
  useEffect(() => {
    if (!isFrontCamera) return;
    if (!('wakeLock' in navigator)) return;
    let wakeLock = null;
    let released = false;
    const requestWakeLock = async () => {
      if (released) return;
      try {
        wakeLock = await navigator.wakeLock.request('screen');
      } catch {
        // Request can fail (e.g. tab not visible); safe to ignore.
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') requestWakeLock();
    };
    requestWakeLock();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLock) wakeLock.release().catch(() => {});
    };
  }, [isFrontCamera]);

  useEffect(() => {
    // Clear residual elements left by a previous html5-qrcode instance
    // (e.g. after a facingMode change) so the new instance starts cleanly.
    const container = document.getElementById('barcode-reader');
    if (container) {
      while (container.firstChild) container.removeChild(container.firstChild);
    }

    const html5QrCode = new Html5Qrcode('barcode-reader');
    let stopped = false;
    setCameraError(null);

    html5QrCode
      .start(
        { facingMode },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          if (stopped) return;

          // Reset clear-frame counter — a barcode is visible
          clearFramesRef.current = 0;

          // Duplicate protection: skip if same barcode is still in view
          if (lastScannedRef.current === decodedText) return;

          if (continuousRef.current) {
            // Continuous mode — process without stopping the camera
            lastScannedRef.current = decodedText;
            setScanCount((c) => c + 1);
            playBlip();
            onScanRef.current(decodedText, { continuous: true });
          } else {
            // Single-scan mode — stop camera then fire callback
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
          // No barcode detected this frame — increment clear counter.
          // After enough clear frames, allow the same barcode to be scanned
          // again (the user moved the product away and may bring it back).
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
  }, [facingMode]);

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

  const handleFlipCamera = () => {
    setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'));
  };

  return (
    <div className={`fixed inset-0 z-50 flex flex-col items-center justify-center transition-colors duration-300 ${isFrontCamera ? 'bg-white' : 'bg-black/90'}`}>
      <div className="w-full max-w-sm px-4">
        <p className={`text-center text-lg font-semibold mb-4 ${isFrontCamera ? 'text-gray-900' : 'text-white'}`}>
          {continuous
            ? `Scan barcodes (${scanCount} scanned)`
            : 'Scan a barcode'}
        </p>
        {continuous && discoverQueueLength > 0 && (
          <p className="text-center text-sm text-amber-400 mb-2">
            🔍 {discoverQueueLength} queued for lookup
          </p>
        )}
        {isFrontCamera && (
          <p className="text-gray-500 text-center text-xs mb-2" aria-label="Screen illumination is on — hold barcode close">
            💡 Screen illumination on — hold barcode close
          </p>
        )}
        <div
          id="barcode-reader"
          className="w-full rounded-lg overflow-hidden"
          style={isFrontCamera ? { transform: 'scaleX(-1)' } : undefined}
        />

        {/* Camera controls — only when camera is active */}
        {!cameraError && (
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleFlipCamera}
              className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              title="Flip camera"
            >
              🔄 Flip
            </button>
            {!initialContinuous && (
              <button
                onClick={() => setContinuous((c) => !c)}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
                  continuous
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : 'bg-gray-700 hover:bg-gray-600 text-white'
                }`}
              >
                {continuous ? '♾️ Continuous ON' : '♾️ Continuous OFF'}
              </button>
            )}
          </div>
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
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
                autoFocus
              />
              <button
                type="submit"
                disabled={!manualBarcode.trim()}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors"
              >
                Submit
              </button>
            </form>
          </>
        )}

        {continuous ? (
          <div className="mt-4 flex flex-col gap-2">
            {initialContinuous && (
              <button
                onClick={() => onCloseRef.current({ scanned: 0 })}
                className="w-full py-2 px-5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-base font-semibold transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              onClick={() => onCloseRef.current({ scanned: scanCount })}
              className="w-full py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg text-lg font-semibold transition-colors"
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
                className="font-semibold text-emerald-400 hover:text-emerald-300 underline flex-shrink-0"
              >
                Undo
              </button>
            )}
          </div>
          {t.type === 'undo' && (
            <div
              className="h-1 bg-emerald-400"
              style={{ animation: 'toast-shrink 5s linear forwards' }}
            />
          )}
        </div>
      ))}
    </div>
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
  const [showScanner, setShowScanner] = useState(false);
  const [showInventoryScanner, setShowInventoryScanner] = useState(false);
  const [scraperAvailable, setScraperAvailable] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const lastScanTimeRef = useRef(0);
  const lastScanBarcodeRef = useRef(null);
  const SCAN_COOLDOWN_MS = 5000;
  // Inventory mode: accumulate per-product counts instead of adding stock immediately
  const inventoryCountsRef = useRef({});  // productId → scanned count
  const inventoryNamesRef = useRef({});   // productId → product name
  const [inventoryCounts, setInventoryCounts] = useState({});
  const invLastBarcodeRef = useRef(null); // inventory-specific cooldown (avoids clashing with normal scan)
  const invLastTimeRef = useRef(0);

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
    const [stockRes, groupsRes, locationsRes] = await Promise.all([
      axios.get(`${API_BASE}/stock`),
      axios.get(`${API_BASE}/product-groups`),
      axios.get(`${API_BASE}/locations`),
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
    };
  }, []);

  // ---- Apply fetched data to state ----------------------------------------
  const applyStockData = useCallback(({ items, groups, locations: locs }) => {
    setStockItems(items);
    setProductGroups(groups);
    setLocations(locs);
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
        const extraCount = discoverPendingCountsRef.current[barcode] ?? 0;
        delete discoverPendingCountsRef.current[barcode];
        if (extraCount > 0 && result?.product?.id) {
          try {
            await axios.post(`${API_BASE}/stock/add`, {
              product_id: result.product.id,
              amount: extraCount,
            });
          } catch {
            // non-fatal — best-effort
          }
          addToast(`Discovered: ${name} (+${extraCount} more added)`, 'success');
        } else {
          addToast(`Discovered: ${name}`, 'success');
        }
      } else if (result?.status === 'running') {
        delete discoverPendingCountsRef.current[barcode];
        addToast(`Lookup timed out for ${barcode}. Check scraper logs.`, 'error');
      } else {
        delete discoverPendingCountsRef.current[barcode];
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
  }, [addToast, refreshStock]);

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
    [addToast, refreshStock, scraperAvailable, processDiscoverQueue],
  );

  // ---- Scanner close handler -----------------------------------------------
  // Called when the scanner is cancelled or the user presses Finish.
  // If discovers are still queued they keep processing in the background;
  // processDiscoverQueue refreshes stock when the queue drains.
  const handleScannerClose = useCallback(
    async ({ scanned = 0 } = {}) => {
      setShowScanner(false);
      if (scanned > 0 && discoverQueueRef.current.length === 0) {
        await refreshStock();
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
      } else {
        try {
          await axios.post(`${API_BASE}/barcode-queue`, { barcode, source: 'inventory-scan' });
          addToast('Barcode queued for lookup', 'info');
        } catch {
          addToast('Failed to queue barcode.', 'error');
        }
      }
    },
    [addToast, scraperAvailable, processDiscoverQueue],
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
      invLastBarcodeRef.current = null;
      invLastTimeRef.current = 0;

      await refreshStock();
    },
    [addToast, refreshStock, scraperAvailable, stockItems],
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
  const handleItemClick = useCallback(
    (productId) => setSelectedProductId(productId),
    [],
  );

  const handleCloseOverlay = useCallback(
    () => setSelectedProductId(null),
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

  const sortedGroupIds = [
    ...Object.keys(grouped)
      .filter((id) => id !== '__ungrouped__')
      .sort((a, b) =>
        (groupMap[a]?.name ?? '').localeCompare(groupMap[b]?.name ?? ''),
      ),
    ...(grouped.__ungrouped__ ? ['__ungrouped__'] : []),
  ];

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
            onClick={() => setShowInventoryScanner(true)}
            className="w-10 h-10 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 rounded-full flex items-center justify-center text-white text-lg shadow-lg transition-colors"
            title="Inventory count"
            aria-label="Inventory count"
          >
            📋
          </button>
          <button
            onClick={() => setShowScanner(true)}
            className="w-10 h-10 bg-green-600 hover:bg-green-500 active:bg-green-700 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-lg transition-colors"
            title="Scan barcode"
            aria-label="Scan barcode"
          >
            +
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
                  ? 'tab-active bg-emerald-600 text-white'
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
                      ? 'tab-active bg-emerald-600 text-white'
                      : 'bg-gray-700/70 text-gray-300 hover:bg-gray-600/80'
                  }`}
                >
                  {loc.name}
                </button>
              ))}
          </div>
          {/* Green baseline */}
          <div className="h-0.5 bg-emerald-600" />
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

      {/* ── Barcode scanner overlay ────────────────────────────────── */}
      {showScanner && (
        <BarcodeScanner
          onScan={handleBarcodeScan}
          onClose={handleScannerClose}
          discoverQueueLength={discoverQueue.length}
        />
      )}

      {/* ── Inventory scanner overlay ──────────────────────────────── */}
      {showInventoryScanner && (
        <BarcodeScanner
          onScan={handleInventoryBarcodeScan}
          onClose={handleInventoryClose}
          discoverQueueLength={discoverQueue.length}
          initialContinuous
        />
      )}

      {/* ── Toasts ─────────────────────────────────────────────────────── */}
      <Toasts toasts={toasts} />
    </div>
  );
}
