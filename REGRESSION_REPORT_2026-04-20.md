# Regression Report

Date: 2026-04-20
Scope: cards-only schema stabilization, verify parent-child migration, frontend rendering consistency

## Auto Checks

1. Backend build
- Command: npm run build
- Status: PASS

2. Card content audit
- Command: npm run d1:audit:card-content
- Status: PASS
- Notes: required fields for en and zh_TW are populated

3. Remote verify structure check
- Command: wrangler d1 execute remote query on card index 7
- Status: PASS
- Result:
  - en: verify_id=verify, type=grid-tree, groups=2, first_group_items=2
  - zh_TW: verify_id=verify, type=grid-tree, groups=2, first_group_items=2

4. Frontend build
- Command: ng build
- Status: PASS

## Functional Coverage Matrix

1. Data model
- cards-only schema in use: PASS
- verify uses parent-child structure: PASS

2. Rendering safety
- empty/duplicate list cleanup in frontend: PASS (code-level)
- verify icon-list fallback conversion to tree data: PASS (code-level)

3. Persistence
- edit API persists to card_content.cards: PASS (code-level)
- profile headline no longer overwritten by card title label: PASS (code-level)

## Manual Checks Pending

1. Edit verify parent name in UI, save, reload page
- Expected: updated parent name persists and re-renders correctly

2. Edit verify child item in UI, save, reload page
- Expected: updated child item persists and re-renders correctly

3. Add/delete verify child item in UI, save, reload page
- Expected: item operations persist without duplicated or empty rows

4. Cross-language isolation
- Expected: editing zh_TW verify does not alter en verify, and vice versa

## Release Recommendation

Status: READY FOR UAT

Rationale:
- all automated checks passed
- verify parent-child structure confirmed in remote D1 for both locales
- build pipelines are green for backend and frontend
