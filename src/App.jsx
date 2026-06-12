import { useState, useEffect, useRef, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import "./App.css";

// ── Audio ──────────────────────────────────────────────────────────────────
function beep(type = "success") {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "success") {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } else {
      // ── FEATURE 6: distinct lower-pitched duplicate warning beep ──────────
      // Two descending tones (260 Hz → 200 Hz) so it sounds clearly different
      // from the rising success chirp.
      osc.frequency.setValueAtTime(260, ctx.currentTime);
      osc.frequency.setValueAtTime(200, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch (_) {
    /* silently ignore if AudioContext unavailable */
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function timestamp() {
  return new Date().toISOString();
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── FEATURE 2: Open Library API fetch ─────────────────────────────────────
// Returns { title, authors } or defaults if the API fails / book not found.
async function fetchBookDetails(isbn) {
  try {
    const res = await fetch(
      `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`
    );
    if (!res.ok) throw new Error("network error");
    const data = await res.json();
    const key = `ISBN:${isbn}`;
    if (!data[key]) return { title: "Title Unknown", authors: "Author Unknown" };
    const book = data[key];
    const title = book.title || "Title Unknown";
    const authors = book.authors?.map((a) => a.name).join(", ") || "Author Unknown";
    return { title, authors };
  } catch (_) {
    return { title: "Title Unknown", authors: "Author Unknown" };
  }
}

// ── FEATURE 4: localStorage helpers ───────────────────────────────────────
const LS_KEY = "librascan_scans";

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function saveToStorage(scans) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(scans));
  } catch (_) {}
}

// ── ISBN validation helper ─────────────────────────────────────────────────
// Accepts 10- or 13-digit strings (digits only, ISBN-10 may end in X).
function isValidISBN(value) {
  const cleaned = value.trim().replace(/[-\s]/g, "");
  return /^\d{9}[\dX]$/.test(cleaned) || /^\d{13}$/.test(cleaned);
}

const COOLDOWN_MS = 2500;

// ── Component ──────────────────────────────────────────────────────────────
export default function App() {
  // ── FEATURE 4: hydrate state from localStorage on first render ───────────
  const [scans, setScans] = useState(() => loadFromStorage());
  // scans shape: { id, isbn, scannedAt, title, authors }

  const [scanning, setScanning]   = useState(false);
  const [flash, setFlash]         = useState(null);   // { isbn, type }
  const [camError, setCamError]   = useState(null);

  // ── FEATURE 1: manual input state ─────────────────────────────────────
  const [manualInput, setManualInput] = useState("");
  const [manualError, setManualError] = useState(null);

  // ── FEATURE 5: torch state ─────────────────────────────────────────────
  const [torchOn, setTorchOn]     = useState(false);
  const [torchSupported, setTorchSupported] = useState(true);

  // ── FEATURE 6: duplicate highlight — set of ISBNs currently flashing ──
  const [highlightISBNs, setHighlightISBNs] = useState(new Set());

  const scannerRef    = useRef(null);
  const lastScanRef   = useRef({ isbn: null, time: 0 });
  const readerDivId   = "html5qr-reader";

  // ── FEATURE 4: persist to localStorage whenever scans changes ───────────
  useEffect(() => {
    saveToStorage(scans);
  }, [scans]);

  // ── Core: process an ISBN (shared by scanner + manual input) ─────────────
  // Returns true if added, false if duplicate/invalid.
  const processISBN = useCallback(async (rawIsbn) => {
    const isbn = rawIsbn.trim().replace(/[-\s]/g, "");

    // ── FEATURE 6: duplicate → highlight existing item + warning beep ─────
    let isDuplicate = false;
    setScans((prev) => {
      isDuplicate = prev.some((s) => s.isbn === isbn);
      return prev; // no state change here, just reading
    });

    // Re-read synchronously via a local variable approach
    // (setScans callback above sets isDuplicate via closure)
    // We use a functional read trick: call setScans with identity fn to read latest
    let currentScans;
    setScans((prev) => { currentScans = prev; return prev; });

    // Small tick to let the above settle
    await new Promise((r) => setTimeout(r, 0));

    setScans((prev) => {
      const dup = prev.some((s) => s.isbn === isbn);
      if (dup) {
        beep("duplicate");
        setFlash({ isbn, type: "duplicate" });
        setTimeout(() => setFlash(null), 1200);

        // ── FEATURE 6: flash the matching list item ────────────────────────
        setHighlightISBNs((h) => new Set([...h, isbn]));
        setTimeout(() => {
          setHighlightISBNs((h) => {
            const next = new Set(h);
            next.delete(isbn);
            return next;
          });
        }, 1000);

        return prev;
      }

      // New book — show optimistic entry immediately, then enrich with API data
      const newEntry = {
        id: crypto.randomUUID(),
        isbn,
        scannedAt: timestamp(),
        title: "Loading…",
        authors: "",
      };

      beep("success");
      setFlash({ isbn, type: "success" });
      setTimeout(() => setFlash(null), 1200);

      // ── FEATURE 2: background API fetch, update entry when resolved ───────
      fetchBookDetails(isbn).then((details) => {
        setScans((latest) =>
          latest.map((s) =>
            s.isbn === isbn ? { ...s, title: details.title, authors: details.authors } : s
          )
        );
      });

      return [newEntry, ...prev];
    });

    return true;
  }, []);

  // ── Start scanner ──────────────────────────────────────────────────────
  const startScanner = useCallback(async () => {
    setCamError(null);
    setTorchOn(false);
    const html5qr = new Html5Qrcode(readerDivId);
    scannerRef.current = html5qr;

    const config = {
      fps: 12,
      qrbox: { width: 280, height: 140 },
      formatsToSupport: [
        window.Html5QrcodeSupportedFormats?.EAN_13 ?? 8,
        window.Html5QrcodeSupportedFormats?.EAN_8  ?? 7,
        window.Html5QrcodeSupportedFormats?.UPC_A  ?? 12,
        window.Html5QrcodeSupportedFormats?.UPC_E  ?? 13,
      ],
      rememberLastUsedCamera: true,
    };

    try {
      await html5qr.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
          const now = Date.now();
          const last = lastScanRef.current;
          if (last.isbn === decodedText && now - last.time < COOLDOWN_MS) return;
          lastScanRef.current = { isbn: decodedText, time: now };
          processISBN(decodedText);
        },
        () => {}
      );
      setScanning(true);
    } catch (err) {
      setCamError(
        err?.message?.includes("Permission")
          ? "Camera permission denied. Please allow camera access and try again."
          : `Could not start camera: ${err?.message ?? err}`
      );
    }
  }, [processISBN]);

  // ── Stop scanner ───────────────────────────────────────────────────────
  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch (_) {}
      scannerRef.current = null;
    }
    setScanning(false);
    setTorchOn(false);
  }, []);

  useEffect(() => () => { stopScanner(); }, [stopScanner]);

  // ── FEATURE 5: Toggle torch ─────────────────────────────────────────────
  const toggleTorch = useCallback(async () => {
    if (!scannerRef.current) return;
    const next = !torchOn;
    try {
      await scannerRef.current.applyVideoConstraints({
        advanced: [{ torch: next }],
      });
      setTorchOn(next);
    } catch (_) {
      // Device / browser doesn't support torch — hide the button going forward
      setTorchSupported(false);
    }
  }, [torchOn]);

  // ── Delete ─────────────────────────────────────────────────────────────
  const deleteScan = (id) => setScans((prev) => prev.filter((s) => s.id !== id));

  // ── FEATURE 3: Clear All ────────────────────────────────────────────────
  const clearAll = () => {
    if (window.confirm("Clear all scanned books? This cannot be undone.")) {
      setScans([]);
    }
  };

  // ── FEATURE 1: Manual submit ────────────────────────────────────────────
  const handleManualAdd = async () => {
    setManualError(null);
    const val = manualInput.trim();
    if (!val) return;
    if (!isValidISBN(val)) {
      setManualError("Enter a valid 10- or 13-digit ISBN.");
      return;
    }
    await processISBN(val);
    setManualInput("");
  };

  const handleManualKeyDown = (e) => {
    if (e.key === "Enter") handleManualAdd();
  };

  // ── Export ─────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const rows = [
      "isbn,title,authors,scannedAt",
      ...scans.map((s) =>
        `${s.isbn},"${(s.title || "").replace(/"/g, '""')}","${(s.authors || "").replace(/"/g, '""')}",${s.scannedAt}`
      ),
    ];
    downloadFile(rows.join("\n"), "isbn-scans.csv", "text/csv");
  };

  const exportJSON = () => {
    downloadFile(
      JSON.stringify(
        scans.map(({ isbn, title, authors, scannedAt }) => ({ isbn, title, authors, scannedAt })),
        null,
        2
      ),
      "isbn-scans.json",
      "application/json"
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            <span>LibraScan</span>
          </div>
          <div className="counter-pill">
            <span className="counter-num">{scans.length}</span>
            <span className="counter-label">{scans.length === 1 ? "book" : "books"}</span>
          </div>
        </div>
      </header>

      <main className="main">
        {/* ── Scanner card ── */}
        <section className="scanner-card">
          <div className="scanner-label">
            {scanning ? (
              <span className="live-dot-wrap"><span className="live-dot" />Scanning — point at barcode</span>
            ) : (
              <span>Camera off</span>
            )}
          </div>

          <div
            id={readerDivId}
            className={`reader-container ${scanning ? "reader-active" : ""}`}
          />

          {flash && (
            <div className={`scan-flash ${flash.type}`}>
              {flash.type === "success" ? "✓ Added" : "Already scanned"}
              <span className="flash-isbn">{flash.isbn}</span>
            </div>
          )}

          {camError && (
            <div className="cam-error">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {camError}
            </div>
          )}

          {/* ── Camera controls row ── */}
          <div className="scanner-controls">
            {!scanning ? (
              <button className="btn btn-primary btn-lg" onClick={startScanner}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                Start Camera
              </button>
            ) : (
              <>
                {/* ── FEATURE 5: Torch toggle — only shown while scanning ── */}
                {torchSupported && (
                  <button
                    className={`btn btn-sm ${torchOn ? "btn-torch-on" : "btn-ghost"}`}
                    onClick={toggleTorch}
                    title="Toggle flashlight"
                  >
                    {/* Flashlight / bolt icon */}
                    <svg width="15" height="15" viewBox="0 0 24 24" fill={torchOn ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                    {torchOn ? "Torch On" : "Torch"}
                  </button>
                )}
                <button className="btn btn-ghost btn-lg" onClick={stopScanner}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
                  Stop Camera
                </button>
              </>
            )}
          </div>

          {/* ── FEATURE 1: Manual ISBN input ── */}
          <div className="manual-input-row">
            <input
              type="text"
              inputMode="numeric"
              className="manual-input"
              placeholder="Enter ISBN manually…"
              value={manualInput}
              onChange={(e) => { setManualInput(e.target.value); setManualError(null); }}
              onKeyDown={handleManualKeyDown}
              maxLength={17}
              aria-label="Manual ISBN entry"
            />
            <button className="btn btn-primary btn-sm" onClick={handleManualAdd}>
              Add
            </button>
          </div>
          {manualError && (
            <p className="manual-error">{manualError}</p>
          )}
        </section>

        {/* ── List ── */}
        <section className="list-section">
          <div className="list-header">
            <h2 className="list-title">Scanned Books</h2>
            <div className="list-actions">
              {/* ── FEATURE 3: Clear All ── */}
              {scans.length > 0 && (
                <button className="btn btn-outline btn-sm btn-danger-outline" onClick={clearAll}>
                  Clear All
                </button>
              )}
              {scans.length > 0 && (
                <div className="export-row">
                  <button className="btn btn-outline btn-sm" onClick={exportCSV}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                    CSV
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={exportJSON}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                    JSON
                  </button>
                </div>
              )}
            </div>
          </div>

          {scans.length === 0 ? (
            <div className="empty-state">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity=".35"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              <p>No books scanned yet.<br/>Start the camera and scan a barcode.</p>
            </div>
          ) : (
            <ul className="isbn-list">
              {scans.map((scan) => (
                <li
                  key={scan.id}
                  className={`isbn-item ${highlightISBNs.has(scan.isbn) ? "isbn-item--duplicate-flash" : ""}`}
                >
                  {/* ── FEATURE 2: book metadata display ── */}
                  <div className="isbn-body">
                    <span className="book-title">{scan.title || "Title Unknown"}</span>
                    <span className="book-authors">{scan.authors || "Author Unknown"}</span>
                    <span className="isbn-num">{scan.isbn}</span>
                    <span className="isbn-time">{new Date(scan.scannedAt).toLocaleTimeString()}</span>
                  </div>
                  <button
                    className="btn-delete"
                    onClick={() => deleteScan(scan.id)}
                    aria-label={`Delete ${scan.isbn}`}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
