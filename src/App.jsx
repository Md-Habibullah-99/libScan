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
      // duplicate / error
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
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

const COOLDOWN_MS = 2500;

// ── Component ──────────────────────────────────────────────────────────────
export default function App() {
  const [scans, setScans] = useState([]); // { id, isbn, scannedAt }
  const [scanning, setScanning] = useState(false);
  const [flash, setFlash] = useState(null); // { isbn, type }
  const [camError, setCamError] = useState(null);

  const scannerRef = useRef(null);
  const lastScanRef = useRef({ isbn: null, time: 0 });
  const readerDivId = "html5qr-reader";

  // ── Start scanner ──────────────────────────────────────────────────────
  const startScanner = useCallback(async () => {
    setCamError(null);
    const html5qr = new Html5Qrcode(readerDivId);
    scannerRef.current = html5qr;

    const config = {
      fps: 12,
      qrbox: { width: 280, height: 140 },
      formatsToSupport: [
        // EAN-13 covers standard book barcodes / ISBN-13
        window.Html5QrcodeSupportedFormats?.EAN_13 ?? 8,
        window.Html5QrcodeSupportedFormats?.EAN_8 ?? 7,
        window.Html5QrcodeSupportedFormats?.UPC_A ?? 12,
        window.Html5QrcodeSupportedFormats?.UPC_E ?? 13,
      ],
      rememberLastUsedCamera: true,
    };

    try {
      await html5qr.start(
        { facingMode: "environment" },
        config,
        (decodedText) => handleScan(decodedText),
        () => {} // ignore per-frame errors
      );
      setScanning(true);
    } catch (err) {
      setCamError(
        err?.message?.includes("Permission")
          ? "Camera permission denied. Please allow camera access and try again."
          : `Could not start camera: ${err?.message ?? err}`
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, []);

  // Cleanup on unmount
  useEffect(() => () => { stopScanner(); }, [stopScanner]);

  // ── Handle a successful decode ─────────────────────────────────────────
  const handleScan = useCallback((isbn) => {
    const now = Date.now();
    const last = lastScanRef.current;

    // Cooldown guard (same ISBN within COOLDOWN_MS)
    if (last.isbn === isbn && now - last.time < COOLDOWN_MS) return;
    lastScanRef.current = { isbn, time: now };

    setScans((prev) => {
      const isDuplicate = prev.some((s) => s.isbn === isbn);
      if (isDuplicate) {
        beep("duplicate");
        setFlash({ isbn, type: "duplicate" });
        setTimeout(() => setFlash(null), 1200);
        return prev;
      }
      beep("success");
      setFlash({ isbn, type: "success" });
      setTimeout(() => setFlash(null), 1200);
      return [{ id: crypto.randomUUID(), isbn, scannedAt: timestamp() }, ...prev];
    });
  }, []);

  // ── Delete ─────────────────────────────────────────────────────────────
  const deleteScan = (id) => setScans((prev) => prev.filter((s) => s.id !== id));

  // ── Export ─────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const rows = ["isbn,scannedAt", ...scans.map((s) => `${s.isbn},${s.scannedAt}`)];
    downloadFile(rows.join("\n"), "isbn-scans.csv", "text/csv");
  };

  const exportJSON = () => {
    downloadFile(
      JSON.stringify(scans.map(({ isbn, scannedAt }) => ({ isbn, scannedAt })), null, 2),
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

          {/* html5-qrcode mounts into this div */}
          <div
            id={readerDivId}
            className={`reader-container ${scanning ? "reader-active" : ""}`}
          />

          {/* Overlay flash */}
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

          <div className="scanner-controls">
            {!scanning ? (
              <button className="btn btn-primary btn-lg" onClick={startScanner}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                Start Camera
              </button>
            ) : (
              <button className="btn btn-ghost btn-lg" onClick={stopScanner}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
                Stop Camera
              </button>
            )}
          </div>
        </section>

        {/* ── List ── */}
        <section className="list-section">
          <div className="list-header">
            <h2 className="list-title">Scanned ISBNs</h2>
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

          {scans.length === 0 ? (
            <div className="empty-state">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity=".35"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              <p>No books scanned yet.<br/>Start the camera and scan a barcode.</p>
            </div>
          ) : (
            <ul className="isbn-list">
              {scans.map((scan, i) => (
                <li key={scan.id} className="isbn-item" style={{ animationDelay: `${i === 0 ? 0 : 0}ms` }}>
                  <div className="isbn-body">
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
