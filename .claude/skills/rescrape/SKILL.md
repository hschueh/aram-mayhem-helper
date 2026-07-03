---
name: rescrape
description: Use when the user asks to rescrape, refetch, update, or "run fetch" for the ARAM Mayhem data in this repo (aram-mayhem-helper).
---

# Rescrape ARAM Mayhem Data

## Steps

1. Run the scraper in the background (takes several minutes, ~173 champions):

   ```bash
   npx ts-node --transpile-only scraper.ts
   ```

   **Must use `--transpile-only`** — plain `ts-node` fails with TS7006 implicit-`any` errors from `page.evaluate` callbacks. Do not "fix" the types; just transpile.

2. When it finishes, verify from the output log:
   - Champion count (compare against the previous run; a higher count means new champions were added)
   - `Champions with augment/ability/build data` all equal the total
   - No `FAILED` lines (the scraper falls back to existing data for failed scrapes — mention any fallbacks to the user)

3. Check `git status --short`. Expected changes: `Champions.md`, `aram-mayhem-data.json`, `frontend/aram-mayhem-data.json`, all of `champions/*.md`. A `??` file under `champions/` is a new champion — call it out.

4. Commit (staging only the paths above, never `git add -A`):

   ```
   chore: rescrape ARAM Mayhem data (YYYY-MM-DD)
   ```

   Mention new champions in the commit body if any.

5. Report to the user: total champions, any new champions, any scrape failures/fallbacks, and the commit hash.

## Notes

- The scraper scrapes both zh-tw and en locales and syncs the JSON to `frontend/` automatically.
- Data files are large (~470k lines change per rescrape) — skip `git diff` when committing.
