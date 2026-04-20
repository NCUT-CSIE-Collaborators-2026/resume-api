# Final Acceptance Checklist

## Goal
Stabilize resume content on cards-only schema (`card_content.cards`) with reliable edit persistence and deterministic recovery scripts.

## Data Model
- [ ] Payload keeps resume data in `card_content.cards` only.
- [ ] Card identity uses `id` and does not use title as key.
- [ ] Profile name and headline are stored in profile card entry fields (`name`, `headline`).

## Backend
- [ ] `POST /content.card/update` updates card snapshot into `card_content.cards`.
- [ ] Profile card save does not overwrite `headline` from card UI title text.
- [ ] Build passes with `npm run build`.

## Frontend
- [ ] Top header shows profile name and headline from card data.
- [ ] Profile status is shown as status, not as top headline fallback.
- [ ] Rendering sanitizes card elements by filtering empty and duplicate list items.
- [ ] Build passes with `ng build`.

## Operations
- [ ] `npm run d1:status:remote` returns both locales.
- [ ] `npm run d1:audit:card-content` passes.
- [ ] Backfill script behavior is documented (structured card elements are replaced from seed).

## Regression Spot Checks
- [ ] Edit profile card badges and save, then refresh: changes persist.
- [ ] Edit intro 30s and 60s text separately and save: both variants persist by intro mode.
- [ ] Education/experience cards show no empty icon-only rows.
- [ ] No mixed-language duplicate groups appear in a single locale.
