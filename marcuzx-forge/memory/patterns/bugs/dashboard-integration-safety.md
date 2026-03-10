# Bug Pattern: Dashboard Integration Safety

When the main dashboard shell is already modified, prefer additive routes over deep edits. This avoids bundling unrelated work into the same commit and lowers review risk.
