### 2026-03-04 — Use db:push rather than migrations
Chose to skip the migration layer while the schema is still moving weekly.
Accepted cost: no rollback path, so production changes need a manual backup first.
Revisit when the schema settles or a second developer joins.
