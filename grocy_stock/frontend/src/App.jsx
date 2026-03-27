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

const API_BASE = `${INGRESS_PATH}/api/grocy`;
const BBUDDY_API = `${INGRESS_PATH}/api/bbuddy`;

// ---------------------------------------------------------------------------
// Helper – encode a Grocy picture filename for the files API (Base64)
// ---------------------------------------------------------------------------
function pictureUrl(filename, width = 100) {
  if (!filename) return null;
  try {
    return `${API_BASE}/files/productpictures/${btoa(filename)}?force_serve_as=picture&best_fit_width=${width}`;
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
// ProductDetailOverlay
// Full-screen overlay with product details and action buttons.
// ---------------------------------------------------------------------------
function ProductDetailOverlay({
  item,
  onClose,
  onToggleKeep,
  onAdd,
  onConsume,
  onConsumeAll,
}) {
  if (!item) return null;

  const product = item.product;
  const name = product?.name ?? 'Unknown Product';
  const amount = item.amount % 1 === 0 ? item.amount : item.amount.toFixed(2);
  const imgUrl = pictureUrl(product?.picture_file_name, 400);
  const minStock = parseFloat(product?.min_stock_amount ?? 0);
  const isKept = minStock >= 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm overlay-enter"
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
          <p className="text-gray-400 mt-1">{amount} in stock</p>
        </div>

        {/* Action buttons */}
        <div className="px-6 pb-6 space-y-3">
          {/* Row: Keep in stock | +1 | -1 */}
          <div className="flex gap-2">
            <button
              onClick={onToggleKeep}
              className={`flex-1 py-3 rounded-xl font-semibold text-white text-sm transition-colors ${
                isKept
                  ? 'bg-red-500 hover:bg-red-600 active:bg-red-700'
                  : 'bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700'
              }`}
            >
              {isKept ? 'Do not keep' : 'Keep in stock'}
            </button>
            <button
              onClick={onAdd}
              className="w-14 py-3 rounded-xl font-bold text-white text-sm bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 transition-colors"
            >
              +1
            </button>
            <button
              onClick={onConsume}
              className="w-14 py-3 rounded-xl font-bold text-white text-sm bg-red-500 hover:bg-red-600 active:bg-red-700 transition-colors disabled:opacity-40"
              disabled={item.amount <= 0}
            >
              −1
            </button>
          </div>

          {/* Consume all */}
          <button
            onClick={onConsumeAll}
            className="w-full py-3 rounded-xl font-semibold text-white text-sm bg-red-500 hover:bg-red-600 active:bg-red-700 transition-colors disabled:opacity-40"
            disabled={item.amount <= 0}
          >
            Consume all
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
// ProductGroup  (collapsible accordion)
// ---------------------------------------------------------------------------
function ProductGroup({ group, items, onConsume, onItemClick }) {
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
              onClick={() => onItemClick(item.product_id)}
              className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-700 last:border-b-0 hover:bg-gray-700/50 transition-colors cursor-pointer"
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
                onClick={(e) => { e.stopPropagation(); onConsume(item.product_id); }}
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

// Number of consecutive "no barcode" frames before the same barcode can be
// re-scanned.  At 10 fps this equals roughly 0.5 s of clear view.
const CLEAR_FRAMES_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Barcode Scanner overlay
// Uses the phone camera to scan barcodes via html5-qrcode.
// Supports single-scan and continuous modes, camera flip, and duplicate-scan
// protection (waits for a "clear" view before allowing the next scan).
// Falls back to manual barcode entry when camera is unavailable.
// ---------------------------------------------------------------------------
function BarcodeScanner({ onScan, onClose }) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [cameraError, setCameraError] = useState(null);
  const [manualBarcode, setManualBarcode] = useState('');
  const [facingMode, setFacingMode] = useState('environment');
  const [continuous, setContinuous] = useState(false);
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
            onScanRef.current(decodedText, { continuous: true });
          } else {
            // Single-scan mode — stop camera then fire callback
            stopped = true;
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
          <button
            onClick={() => onCloseRef.current({ scanned: scanCount })}
            className="mt-4 w-full py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg text-lg font-semibold transition-colors"
          >
            Finish{scanCount > 0 ? ` (${scanCount} scanned)` : ''}
          </button>
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
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`relative rounded-lg shadow-lg text-white text-sm max-w-xs pointer-events-auto overflow-hidden ${
            t.type === 'error'
              ? 'bg-red-600'
              : t.type === 'undo'
                ? 'bg-gray-700'
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
  const [stockItems, setStockItems] = useState([]);
  const [productGroups, setProductGroups] = useState([]);
  const [locations, setLocations] = useState([]);
  const [selectedLocationId, setSelectedLocationId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [showScanner, setShowScanner] = useState(false);

  // Derive the selected item from current stock so it stays in sync
  const selectedItem = selectedProductId
    ? stockItems.find((i) => i.product_id === selectedProductId) ?? null
    : null;

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
        const [stockRes, groupsRes, locationsRes] = await Promise.all([
          axios.get(`${API_BASE}/stock`),
          axios.get(`${API_BASE}/objects/product_groups`),
          axios.get(`${API_BASE}/objects/locations`),
        ]);

        if (cancelled) return;

        const items = Array.isArray(stockRes.data)
          ? stockRes.data
              .filter((item) => parseFloat(item.amount) > 0)
              .map((item) => ({ ...item, amount: parseFloat(item.amount) }))
          : [];

        setStockItems(items);
        setProductGroups(
          Array.isArray(groupsRes.data) ? groupsRes.data : [],
        );
        setLocations(
          Array.isArray(locationsRes.data) ? locationsRes.data : [],
        );
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

  // ---- Refresh stock data helper -------------------------------------------
  const refreshStock = useCallback(async () => {
    try {
      const [stockRes, groupsRes, locationsRes] = await Promise.all([
        axios.get(`${API_BASE}/stock`),
        axios.get(`${API_BASE}/objects/product_groups`),
        axios.get(`${API_BASE}/objects/locations`),
      ]);
      const items = Array.isArray(stockRes.data)
        ? stockRes.data
            .filter((item) => parseFloat(item.amount) > 0)
            .map((item) => ({ ...item, amount: parseFloat(item.amount) }))
        : [];
      setStockItems(items);
      setProductGroups(
        Array.isArray(groupsRes.data) ? groupsRes.data : [],
      );
      setLocations(
        Array.isArray(locationsRes.data) ? locationsRes.data : [],
      );
    } catch {
      addToast('Stock list may be outdated — pull down to refresh.', 'error');
    }
  }, [addToast]);

  // ---- Barcode scan handler ------------------------------------------------
  // Called for each barcode scan (single or continuous mode).
  const handleBarcodeScan = useCallback(
    async (barcode, { continuous = false } = {}) => {
      if (!continuous) {
        setShowScanner(false);
      }

      try {
        // Force Barcode Buddy into purchase mode so products are added, not consumed
        await axios.get(`${BBUDDY_API}/action/scan`, {
          params: { add: 'BBUDDY-P' },
        });
      } catch (err) {
        const msg =
          err?.response?.data?.error ??
          err?.message ??
          'Failed to set purchase mode. Check Barcode Buddy settings.';
        addToast(msg, 'error');
        return;
      }

      try {
        // Scan the actual barcode (now in purchase mode)
        const res = await axios.get(`${BBUDDY_API}/action/scan`, {
          params: { add: barcode },
        });
        addToast(
          res.data?.data?.result ?? 'Barcode scanned successfully',
          'success',
        );
      } catch (err) {
        const msg =
          err?.response?.data?.error ??
          err?.message ??
          'Failed to scan barcode. Check Barcode Buddy settings.';
        addToast(msg, 'error');
        return;
      }

      // In single-scan mode, refresh stock immediately.
      // In continuous mode, stock is refreshed when the scanner is closed.
      if (!continuous) {
        await refreshStock();
      }
    },
    [addToast, refreshStock],
  );

  // ---- Scanner close handler -----------------------------------------------
  // Called when the scanner is cancelled or the user presses Finish.
  const handleScannerClose = useCallback(
    async ({ scanned = 0 } = {}) => {
      setShowScanner(false);
      if (scanned > 0) {
        await refreshStock();
      }
    },
    [refreshStock],
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
            `${API_BASE}/stock/products/${productId}/consume`,
            { amount: 1, transaction_type: 'consume', spoiled: false },
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

  const handleToggleKeepInStock = useCallback(async () => {
    if (!selectedItem) return;
    const productId = selectedItem.product_id;
    const currentMin = parseFloat(selectedItem.product?.min_stock_amount ?? 0);
    const newMin = currentMin >= 1 ? 0 : 1;

    // Optimistic update
    setStockItems((prev) =>
      prev.map((item) =>
        item.product_id === productId
          ? { ...item, product: { ...item.product, min_stock_amount: newMin } }
          : item,
      ),
    );

    try {
      await axios.put(`${API_BASE}/objects/products/${productId}`, {
        min_stock_amount: newMin,
      });
      addToast(
        newMin >= 1 ? 'Marked as keep in stock' : 'Removed from keep in stock',
        'success',
      );
    } catch (err) {
      // Rollback
      setStockItems((prev) =>
        prev.map((item) =>
          item.product_id === productId
            ? {
                ...item,
                product: { ...item.product, min_stock_amount: currentMin },
              }
            : item,
        ),
      );
      addToast(
        err?.response?.data?.detail_message ??
          'Failed to update product.',
        'error',
      );
    }
  }, [selectedItem, addToast]);

  const handleAddStock = useCallback(async () => {
    if (!selectedItem) return;
    const productId = selectedItem.product_id;
    const productName = selectedItem.product?.name ?? 'item';

    // Optimistic update
    setStockItems((prev) =>
      prev.map((item) =>
        item.product_id === productId
          ? { ...item, amount: item.amount + 1 }
          : item,
      ),
    );

    try {
      await axios.post(`${API_BASE}/stock/products/${productId}/add`, {
        amount: 1,
        best_before_date: '2999-12-31',
      });
      addToast(`Added 1 × ${productName}`, 'success');
    } catch (err) {
      // Rollback
      setStockItems((prev) =>
        prev.map((item) =>
          item.product_id === productId
            ? { ...item, amount: item.amount - 1 }
            : item,
        ),
      );
      addToast(
        err?.response?.data?.detail_message ?? 'Failed to add stock.',
        'error',
      );
    }
  }, [selectedItem, addToast]);

  const handleOverlayConsume = useCallback(async () => {
    if (!selectedItem || selectedItem.amount <= 0) return;
    const productId = selectedItem.product_id;
    const productName = selectedItem.product?.name ?? 'item';
    const originalItem = { ...selectedItem };

    // Optimistic update – remove if amount hits zero
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
      addToast(`Consumed 1 × ${productName}`, 'success');
    } catch (err) {
      // Rollback
      setStockItems((prev) => {
        const existing = prev.find((i) => i.product_id === productId);
        if (existing) {
          return prev.map((i) =>
            i.product_id === productId
              ? { ...i, amount: i.amount + 1 }
              : i,
          );
        }
        return [...prev, { ...originalItem, amount: 1 }];
      });
      addToast(
        err?.response?.data?.detail_message ?? 'Failed to consume item.',
        'error',
      );
    }
  }, [selectedItem, addToast]);

  const handleConsumeAll = useCallback(async () => {
    if (!selectedItem || selectedItem.amount <= 0) return;
    const productId = selectedItem.product_id;
    const productName = selectedItem.product?.name ?? 'item';
    const consumeAmount = selectedItem.amount;
    const originalItem = { ...selectedItem };

    // Optimistic: remove item from stock and close overlay
    setStockItems((prev) =>
      prev.filter((item) => item.product_id !== productId),
    );
    setSelectedProductId(null);

    try {
      await axios.post(
        `${API_BASE}/stock/products/${productId}/consume`,
        {
          amount: consumeAmount,
          transaction_type: 'consume',
          spoiled: false,
        },
      );
      addToast(`Consumed all ${productName}`, 'success');
    } catch (err) {
      // Rollback
      setStockItems((prev) => [...prev, originalItem]);
      addToast(
        err?.response?.data?.detail_message ??
          'Failed to consume items.',
        'error',
      );
    }
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
      <header className="sticky top-0 z-10 bg-gray-800 text-white px-4 py-4 shadow-md border-b border-gray-700 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">🥫 Grocy Stock</h1>
        <button
          onClick={() => setShowScanner(true)}
          className="w-10 h-10 bg-green-600 hover:bg-green-500 active:bg-green-700 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-lg transition-colors"
          title="Scan barcode"
          aria-label="Scan barcode"
        >
          +
        </button>
      </header>

      {/* ── Location tabs ─────────────────────────────────────────────── */}
      {activeLocations.length > 0 && (
        <nav className="sticky top-[60px] z-10 bg-gray-800 px-2 sm:px-4">
          <div className="max-w-2xl mx-auto flex overflow-x-auto scrollbar-hide pt-2">
            <button
              onClick={() => setSelectedLocationId(null)}
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
                  onClick={() => setSelectedLocationId(loc.id)}
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
      <main className="max-w-2xl mx-auto py-4 px-2 sm:px-4 space-y-2">
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
                onItemClick={handleItemClick}
              />
            );
          })
        )}
      </main>

      {/* ── Product detail overlay ─────────────────────────────────── */}
      <ProductDetailOverlay
        item={selectedItem}
        onClose={handleCloseOverlay}
        onToggleKeep={handleToggleKeepInStock}
        onAdd={handleAddStock}
        onConsume={handleOverlayConsume}
        onConsumeAll={handleConsumeAll}
      />

      {/* ── Barcode scanner overlay ────────────────────────────────── */}
      {showScanner && (
        <BarcodeScanner
          onScan={handleBarcodeScan}
          onClose={handleScannerClose}
        />
      )}

      {/* ── Toasts ─────────────────────────────────────────────────────── */}
      <Toasts toasts={toasts} />
    </div>
  );
}
