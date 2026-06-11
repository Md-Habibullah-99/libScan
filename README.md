# LibraScan — ISBN Barcode Scanner

A mobile-first single-page app for scanning book barcodes (EAN-13 / ISBN-13) and managing a collected list of ISBNs. Built with React + Vite, using `html5-qrcode` for camera access.

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Run the dev server

```bash
npm run dev
```

The server starts at `http://localhost:5173`.

> **Testing on a real phone (recommended for camera):**  
> Vite binds to all interfaces with `host: true`. Find your machine's local IP (e.g. `192.168.1.42`) and open `http://192.168.1.42:5173` on your phone while on the same Wi-Fi network.  
> **HTTPS note:** Chrome on Android requires HTTPS for camera access on non-localhost origins. Use either:
> - `npx vite --https` (self-signed, you'll need to accept the cert warning), or  
> - `ngrok http 5173` to get a proper HTTPS tunnel.

### 3. Build for production

```bash
npm run build
npm run preview   # preview the production build locally
```

---

## File Structure

```
isbn-scanner/
├── index.html          # App shell (meta viewport, PWA tags)
├── vite.config.js      # Vite + React plugin
├── package.json
└── src/
    ├── main.jsx        # React root mount
    ├── index.css       # Font imports + global reset
    ├── App.jsx         # Main component (all logic)
    └── App.css         # All styles (dark mobile-first UI)
```

---

## Dependencies

| Package | Purpose |
|---|---|
| `html5-qrcode` | Camera access + barcode decoding (EAN-13, EAN-8, UPC-A/E) |
| `react` / `react-dom` | UI rendering |
| `vite` + `@vitejs/plugin-react` | Build tooling |

No other runtime dependencies.

---

## Features

- **EAN-13/ISBN scanning** — targets book barcode formats specifically via `formatsToSupport`
- **2.5-second cooldown** — prevents duplicate entries from a held scan
- **Duplicate detection** — if you scan a book already in the list, a yellow "Already scanned" flash appears and a low beep plays instead of adding it again
- **Web Audio API beep** — no audio files needed; synthesized in-browser
- **Delete per item** — remove bad scans individually
- **Export CSV / JSON** — triggers a file download on any device
- **Sticky header counter** — always shows how many unique books are recorded
- **Fully offline-capable** — once loaded, no network needed for scanning

---

## Camera Permissions

The app requests the device's **back camera** (`facingMode: "environment"`). On first launch, the browser will ask for camera permission. If denied, an inline error message will guide the user.

---

## Browser Compatibility

| Browser | Support |
|---|---|
| Chrome Android | ✅ Full |
| Safari iOS 16+ | ✅ Full |
| Firefox Android | ✅ Full |
| Chrome Desktop | ✅ Full (webcam) |
| Safari macOS | ✅ Full |
