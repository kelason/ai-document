# Rollback

Use the [tested cutover/recovery runbook](cutover.md#failure-and-rollback). An old application build cannot safely run against the new schema.

Before new account writes: remain in maintenance mode and restore the rehearsed application/database/configuration pair. After new account writes: stop writes, take another encrypted backup and prefer a forward fix; restoring an older snapshot needs an explicitly authorized reconciliation plan so new work is preserved.

Never disable RLS, expose the private archive or infer account ownership from a display name as a rollback shortcut. Rehearse recovery in staging and verify Auth, sharing, expiry, reset and scheduler health before reopening writes.
