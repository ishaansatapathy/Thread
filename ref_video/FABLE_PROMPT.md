# Fable prompt — Thread landing add-ons

Videos (in build order):

| File | What to take from it |
|------|----------------------|
| `03-card-stack-showcase.mp4` | Overlapping product cards stack (restore cards/ showcase) |
| `01-hero-tap-preview.mp4` | Bottom tap/chips change upper preview content |
| `04-agent-scenarios-response.mp4` | Clickable scenarios + side-by-side example response |
| `02-automation-overlap-cards.mp4` | Automation story via clips + overlapping cards |
| `05-process-step-flow.mp4` | Sequential step-by-step flow (extend existing process) |

---

## Copy-paste this into Fable chat

```
Thread Corsair hackathon landing — ADD COMPONENTS ONLY. No redesign.

Rules:
- Do NOT change nav, hero headline/copy, section order, or thread.css tokens
- Adapt ref patterns to Thread theme (black bg, silver borders, blue #3b82f6, Geist)
- No fake Gmail/inbox data — empty states + "Example" labels only
- New code in apps/web/components/thread/ as separate files, wire into existing sections

Watch ref_video/ in this order:
1. 03-card-stack-showcase.mp4 → ThreadCardStack component (restore public/cards/ if needed)
2. 01-hero-tap-preview.mp4 → tap states inside hero #preview window only
3. 04-agent-scenarios-response.mp4 → upgrade ThreadAgent with scenario picker + side response panel
4. 02-automation-overlap-cards.mp4 → overlapping cards section near ThreadWorkflows
5. 05-process-step-flow.mp4 → make ThreadProcess steps clickable (keep scroll reveal + connectors)

After each step: pnpm check-types for apps/web. One component at a time.
```

---

## Optional one-liner (if same chat already has context)

```
Start ref_video build order (03→01→04→02→05). Add-ons only, Thread theme, no redesign, no fake data.
```
