# Morning Desk

A seated, hands-first morning brief for Meta Quest, built as a WebXR app on Meta's Immersive Web SDK (IWSDK). Your table and walls become the dashboard: headline tiles lie flat on your real desk, the main chart hangs on the wall ahead, today's tasks sit on the side wall, and an agent acts on whatever you are looking at.

## Try it

- On Meta Quest: open the hosted page in the Browser and pinch **Enter Morning Desk**.
- On a computer: open the same page; it starts IWSDK's built-in Quest 3 emulator with a synthetic office.
- Judges: see judges.html on the hosted site for a five-minute path.

## Run it

```
npm install
npm run dev        # IWSDK dev server with the Quest 3 emulator
npm run build      # static build in dist/ (GitHub Pages)
npm run snapshot   # refresh the saved copy of the Treasury data
```

## How it is put together

| File | What it does | IWSDK pieces it uses |
|---|---|---|
| src/layout.ts | finds the desk (nearest table whose near edge is within 0.8 m), the facing wall and a side wall; falls back to a lap tray, a curved panel at 1.2 m and a floating side panel | XRPlane, XRMesh (semantic labels) |
| src/app.ts | tiles, chart, tasks, notes, lectern cards, onboarding, settings, agent actions, surface snap after a grab | RayInteractable, PokeInteractable, TwoHandsGrabbable / OneHandGrabbable, XRAnchor, Grabbed |
| src/systems.ts | one action path for pinch, poke and head-gaze dwell; the dwell ring; the frame-time meter | Hovered, Pressed |
| src/agent.ts | turns a question into one action from a fixed schema with a built-in grammar, no network | none (our code) |
| src/data.ts, src/treasury-api.js | Daily Treasury Statement: live fetch, saved-copy fallback, day-over-day movers | none (our code) |
| src/store.ts | settings, saved layout per surface, notes, tasks, visits and streak in localStorage | none (our code) |
| tools/ | Playwright scripts that drive the emulator: room test, measurements, captures | IWER remote control |

## The agent's actions

`add_panel` · `compare` · `filter` · `annotate` · `explain` · `summarize_changes`. The workspace runs only these actions. The built-in grammar maps a question (from the question card, or spoken where the browser offers speech recognition) to one of them, with no network.

## Data

U.S. Treasury Daily Treasury Statement (deposits and withdrawals of operating cash, and the operating cash balance) from the Fiscal Data API, public U.S. Government data. Any public CSV link with date and value columns can replace the chart from the start page.

## Licenses

Apache-2.0 (see LICENSE). Third-party components and their licenses are listed in THIRD-PARTY-LICENSES.md.
