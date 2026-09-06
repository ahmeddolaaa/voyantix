# Voyantix — Recording Checklist

Keep this open on a second screen (or printed) while you record.

---

## Before you hit record

```bash
cd voyantix
npm install
npx drizzle-kit push
npx tsx scripts/seed-demo.ts    # loads the 4 demo voyages
npm run dev                     # http://localhost:3000
```

Then:

- [ ] Browser at **100% zoom**, no bookmarks bar, no extensions visible
- [ ] Window sized so the app fills the frame with no empty space
- [ ] Hide your cursor trail / disable click-highlight extensions
- [ ] Close notifications (Slack, mail, phone mirroring)
- [ ] Record at **60fps if your tool allows** — scroll looks much smoother

**The demo data you'll be recording:**

| Voyage | Vessel | Status | What it shows |
|---|---|---|---|
| VOY-2601 | MV Nile Trader | Cargo Complete | Finalized statement, **Demurrage $18,114.58** |
| VOY-2602 | MV Aegean Spirit | On Laytime | Draft + **one open stoppage running** |
| VOY-2603 | MV Levant Carrier | Cargo Complete | Finalized, **Despatch $13,270.83** |
| VOY-2604 | MV Delta Voyager | On Laytime | Fresh, nothing calculated |

Nothing here is real EZDK data — all invented.

---

## Shot list

### 1 · Cold open — 7s
**Not the app.** Your own messy spreadsheet or a redacted SOF scan.
Scroll slowly. Hold the ugliness.

> "This is how most demurrage claims still get calculated."

---

### 2 · The problem — 13s
Stay on the spreadsheet. Change one cell. Show a total that doesn't
update, or updates wrong.

> "Ten years in shipping ops… every laytime statement rebuilt by hand
> from a scanned SOF. One wrong stoppage time and the figure is wrong."

---

### 3 · THE CUT — 6s ← most important shot
**Hard cut. No fade.** Spreadsheet → `/portfolio`.
Four voyages, clean navy bar, warm background.
**Hold one full second in silence before speaking.**

> "So I built the tool I wanted."

---

### 4 · Field Entry — 12s
Click **VOY-2602** → **Field Entry** in the sidebar.

- The open "Weather Delay" stoppage card is already showing (rust badge)
- Point at it, then click **Close now**
- Now the form appears — pick a reason, hit **Now**, record it

> "Stoppages get recorded as they happen, on the quay. One tap for the
> start time, one tap to close it."

*Move at realistic pace. Don't rush the clicks.*

---

### 5 · The engine — 14s
Sidebar → **Laytime Statement**. Click **Recalculate**.
Draft figures update. Let them sit.

> "The calculation runs off that record. Allowed time, time used, what's
> excluded and why — and the exposure figure."

---

### 6 · The differentiator — 14s ← sells the product
Go to **VOY-2601** (the Finalized one) → **Laytime Statement**.
Scroll to the time sheet table. Move slowly across the
**Counted / Excluded** and **On Laytime / On Demurrage** badges and the
stoppage reason column.

> "Every interval is on the record. Which hours counted, which were
> excluded, which stoppage caused it. When a counterparty disputes the
> claim, the working is already there."

*If you cut anything for length, do not cut this shot.*

---

### 7 · Close — 14s
Back to **/portfolio**. Hold steady, no movement.

> "It's called Voyantix. It's early — built around how this work actually
> gets done. If you handle laytime or demurrage and you'd tell me what
> I've got wrong, I'd like to hear it."

---

### 8 · End card — 5s
`video-assets/end-card.html` — open in browser, screenshot the card,
drop it in as a still.

---

## Optional extra shots (only if you need length)

- **Timeline** (VOY-2601) — stoppages and shifts interleaved
  chronologically. Reads well visually.
- **Audit Trail** (VOY-2601) — shows "Statement finalized" in the log.
  Good if you want to lean harder on traceability.

---

## In the edit

- [ ] Burn in captions — `video-assets/captions.srt` (LinkedIn autoplays muted)
- [ ] Export **1:1** (1080×1080) or **4:5** (1080×1350) — not 16:9
- [ ] Keep total under **90 seconds**
- [ ] Music optional and *sparse* — corporate-uplifting stock will make
      it look like an ad. Silence with clean captions is fine.

---

## Don't

- Don't show real EZDK vessel names, quantities or commercial figures
- Don't add zoom/pan motion effects — the restraint is what makes it read
  as a real product
- Don't put a URL on the end card unless the site is actually live
