# Recovery archive, 2026-09-07

Fourteen commits held no reference in this repository: five stash entries, whose only
copy was the local `refs/stash` reflog, and nine unreachable commits that `git gc`
prunes once they pass its two-week horizon. The oldest dated from 2026-09-03, so that
horizon was about to arrive. Each is now an annotated tag under `archive/2026-09-07/`,
pushed to `fork`, and therefore survives both garbage collection and the loss of this
machine.

The stash stack itself was not touched. Nothing was popped, dropped, or reordered, so
`stash@{0}`..`stash@{4}` still mean to other sessions exactly what they meant before.
Tagging only adds a second, permanent name for the same commit.

## What the archive holds

| Tag suffix under `archive/2026-09-07/` | Origin | Verdict |
| --- | --- | --- |
| `stash-0-wip-chat-ui-keep-out-of-cleanup-build` | `stash@{0}` | Landed. 15 tracked files, 7 untracked; none absent from main. |
| `stash-1-feat-mac-cleanup-monitor-mixed-with-chat` | `stash@{1}` | Landed. The whole `src/lib/mac-cleanup/` subsystem, 53 files; none absent from main. |
| `stash-2-leftover-fleet-mac-cleanup-untracked` | `stash@{2}` | Landed. 33 untracked files; none absent from main. |
| `stash-3-wip-unrelated-chat` | `stash@{3}` | Landed, and a subset of `stash@{0}`. |
| `stash-4-fleet-and-mac-cleanup-preserve-before-ma` | `stash@{4}` | Landed except `fleetAgentLogo()`; see below. |
| `dangling-ac8c1f8-provide-worker-git-identity` | unreachable | Landed with later drift. |
| `dangling-6b31fb3-stop-leaking-claude-code-auto-compact-wi` | unreachable | Landed as `cb5132c`. |
| `dangling-43b6c78-wip-on-main-9327e04-feat-fly-add-fly-io-` | unreachable | Landed; a one-file WIP snapshot. |
| `dangling-b13d005-production-ui-ux-audit-remediation-and-d` | unreachable | Superseded; see below. |
| `dangling-e7c2ea4-show-all-agent-cli-sessions-on-overview` | unreachable | Landed as `17613d8`. |
| `dangling-12431c9-isolate-live-connector-assumptions` | unreachable | Landed. |
| `dangling-ca45f52-desktop-parity-workspace-with-live-sessi` | unreachable | Landed; 127 files, all present on main. |
| `dangling-b647117-type-jsonl-directory-entries-as-dirent` | unreachable | Landed as `c03de3d`. |
| `dangling-a17bfa2-reconnect-the-openclaw-gateway-instantly` | unreachable | Landed as `c4def93`. |

"Landed" is a content claim, not a SHA claim: every file each entry touches was compared
blob-by-blob against `main`, and for files that had since diverged, every line the entry
added was searched for in main's current version.

## The two entries that are not simply superseded

**`b13d005` is the first-generation Fly design.** It adds eight files main does not have:
`src/lib/fly-worker-protocol.ts`, `src/lib/fly-runtime.ts`, their tests,
`src/app/api/fly/jobs/[id]/route.ts`, `workers/entrypoint.sh`, and
`src/components/dashboard/active-terminal-sessions.tsx` with its test. That is a design
main deliberately left behind rather than work it dropped. The old shape gave each worker
a token (`createWorkerToken`, `authorizedWorkerJob`) and an HTTP route to call back into
the controller. Main's polled transport removed the callback channel altogether — the
worker image now runs `ENTRYPOINT ["node", "/opt/mc-worker/polled.mjs"]` with no shell
wrapper, and the controller reads results itself — so a worker holds no controller
credential at all. Restoring these files would reintroduce that credential.

**`fleetAgentLogo()` from `stash@{4}` is the one genuine gap.** Seven lines mapping the
`claude-2` fleet agent to `/brand/stillpoint-mark.webp`. The asset ships on main and
nothing in `src` references it, so main carries an orphaned file where the stash carries
the code that used it. Either direction closes the gap — restore the helper, or drop the
asset — and which one is right is a product decision, not a recovery one.

## Restoring from the archive

The tags are ordinary commits, so nothing special is needed:

```bash
git show archive/2026-09-07/<tag>                    # read it
git checkout -b recover archive/2026-09-07/<tag>     # work from it
```

A stash tag points at the stash commit, which keeps its three parents:

```bash
git show archive/2026-09-07/stash-1-...^1            # the base it was taken from
git diff archive/2026-09-07/stash-1-...^1 archive/2026-09-07/stash-1-...   # the tracked WIP
git ls-tree -r archive/2026-09-07/stash-1-...^3      # the untracked files it carried
```

`git stash apply archive/2026-09-07/stash-1-...` also works and leaves the stash stack alone.
