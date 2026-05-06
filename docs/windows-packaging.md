# Windows Packaging

Mission Control ships in two Windows formats:

1. **`MissionControl-Setup-<version>.exe`** — a single-file Inno Setup
   installer with a familiar Next/Next/Finish wizard. End users
   double-click it and click through. Registers in **Settings → Apps**
   for clean uninstall. Per-user install, no admin needed.
2. **`mission-control-windows-<version>.zip`** — a portable ZIP that
   contains the same payload plus a PowerShell installer (`install.ps1`).
   Better for CI, scripted deployment, and power users who want full
   visibility into what gets put where.

Both share the same staged bundle (`dist/mission-control-windows/`) — the
installer is just a wizard wrapper around it. Pick whichever is friendlier
for your audience; you can ship both.

## Build the .exe installer

Prerequisites:

- Everything in [Build the ZIP](#build-the-zip) (Node, pnpm, etc.)
- **Inno Setup 6+** for the wizard compiler. Install once with:
  ```powershell
  winget install JRSoftware.InnoSetup
  ```
  …or download from <https://jrsoftware.org/isdl.php>.

Build:

```powershell
pnpm package:windows:installer
# or:
powershell -ExecutionPolicy Bypass -File .\scripts\build-installer.ps1
```

Output: `dist/MissionControl-Setup-<version>.exe` (~140–200 MB). The
script first runs `package-windows.ps1` to (re)stage the bundle, then
invokes `ISCC.exe` with the staged dir as the source. Pass `-SkipStage`
to reuse an already-fresh stage when iterating on the wizard only.

### What the .exe does

1. Welcome / License / Install location wizard pages.
2. Two opt-in tasks: **Autostart at logon** (registers a per-user
   Scheduled Task) and **Open browser after install**.
3. Copies the bundle to the chosen install dir (default
   `%LOCALAPPDATA%\MissionControl`).
4. Generates a fresh `.env` with random AUTH_SECRET / API_KEY using
   `CryptGenRandom` (Inno Pascal calls into `advapi32.dll`). Pre-existing
   `.env` is preserved.
5. Starts the server in the background and (if opted in) opens
   `http://127.0.0.1:3000/setup`.
6. Registers in **Settings → Apps** so the uninstall flow stops the
   server, removes the Scheduled Task, and deletes install files
   (data is preserved unless the user deletes it manually).

### iss script knobs

`scripts/mission-control.iss` accepts these `/D` defines, which
`build-installer.ps1` sets automatically:

| Define          | Purpose                                                       |
| --------------- | ------------------------------------------------------------- |
| `MyAppVersion`  | The version baked into Apps & Features and the .exe filename. |
| `StageDir`      | Source path for `[Files]`. Points at the staged bundle.       |
| `OutputDir`     | Where the compiled `.exe` lands.                              |

If you need to customize further, edit the script directly — it's a few
hundred lines of standard Inno Setup syntax.

## Build the ZIP

Prerequisites on the build machine:

- Windows 10/11 (PowerShell 5.1+).
- Node.js 22+ (the version that runs `pnpm build` doesn't have to match the
  bundled runtime — the packager rebuilds native modules against the bundle).
- pnpm (`corepack enable`).
- Internet access (to download the portable Node runtime on first build).

From the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-windows.ps1
```

Output: `dist/mission-control-windows-<version>.zip` (~120–180 MB).

### Speed up the build

Compression is the long pole and is dominated by Windows Defender real-time
scanning of the staged tree. If the build is taking many minutes, add `dist/`
to Defender's exclusion list (admin PowerShell):

```powershell
Add-MpPreference -ExclusionPath (Resolve-Path .\dist).Path
```

Removed when you no longer need it:

```powershell
Remove-MpPreference -ExclusionPath (Resolve-Path .\dist).Path
```

The packager already prefers `System32\tar.exe` over `Compress-Archive` and
`.NET ZipFile`, which alone gets you most of the way; the Defender exclusion
turns a 10-minute zip step into a ~30-second one.

### Useful flags

| Flag             | Effect                                                                      |
| ---------------- | --------------------------------------------------------------------------- |
| `-NodeVersion`   | Pin the bundled Node.js (default `22.11.0`). Must be a real release on nodejs.org. |
| `-OutputDir`     | Stage and zip somewhere other than `dist/`.                                 |
| `-SkipBuild`     | Reuse an existing `.next/standalone` (fast iteration on packaging logic).   |
| `-NoNodeRuntime` | Don't bundle Node.js (~70 MB smaller; target needs Node 22+ on PATH).       |
| `-NoZip`         | Stop after staging — useful for inspecting `dist/mission-control-windows/`. |

### What the ZIP contains

```
mission-control-windows/
├── app/                  Next.js standalone bundle (server.js + node_modules + .next/static + public)
├── node/                 Portable Node.js (node.exe, LICENSE)
├── launcher.js           Loads .env, sets MISSION_CONTROL_DATA_DIR, requires app/server.js
├── install.ps1           Target-side installer
├── Start.bat             Manual launcher (delegates to launcher.js)
├── Stop.ps1              Stops node.exe processes started from this install
├── Uninstall.ps1         Removes the install (data preserved unless -DeleteData)
├── .env.example          Reference for environment variables
├── README.txt            End-user instructions
└── package.json          Bundle manifest (build host, version, Node version)
```

## Install on the target

On the target machine:

1. Copy the ZIP across (USB, SMB, OneDrive — anything).
2. Right-click → Extract All. Anywhere is fine; the contents live for the
   duration of the install only.
3. Right-click `install.ps1` → **Run with PowerShell**, or from a PowerShell
   prompt in the extracted folder:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```

The installer copies `app/`, `node/`, and the helper scripts into
`%LOCALAPPDATA%\MissionControl`, generates a fresh `.env` with random
`AUTH_SECRET` and `API_KEY`, starts the standalone server, and opens
`http://127.0.0.1:3000/setup` in the default browser.

The extracted ZIP folder is no longer needed after install — you can delete it.

### Installer flags

| Flag           | Default                          | Effect                                                       |
| -------------- | -------------------------------- | ------------------------------------------------------------ |
| `-InstallDir`  | `%LOCALAPPDATA%\MissionControl`  | Where to install.                                            |
| `-DataDir`     | `<InstallDir>\data`              | SQLite DB, tokens file, backups. Persist across reinstalls.  |
| `-Port`        | `3000`                           | Listen port.                                                 |
| `-Hostname`    | `127.0.0.1`                      | Bind address. `0.0.0.0` exposes on the LAN.                  |
| `-AutoStart`   | off                              | Register a Scheduled Task that runs `Start.bat` at logon.    |
| `-NoLaunch`    | off                              | Install only — don't start the server or open the browser.  |
| `-Force`       | off                              | Overwrite an existing install in place (data preserved).    |

## Native module ABI

`better-sqlite3` and `node-pty` ship Node-version-specific `.node` binaries.
The packager exports `npm_config_target=$NodeVersion` and runs
`pnpm rebuild better-sqlite3 node-pty` so the prebuilds in
`.next/standalone/node_modules/...` match the bundled `node.exe` ABI.

If a target ever shows `NODE_MODULE_VERSION` errors at startup:

- Confirm `node\node.exe --version` matches the `nodeVersion` in
  `package.json` next to `install.ps1`.
- If the user passed `-NoNodeRuntime`, they must have Node 22+ on PATH.
- As a last resort, on the target:

  ```powershell
  cd <InstallDir>\app
  & ..\node\node.exe ..\node\npm-rebuild.js  # not bundled by default
  ```

  …or rebuild on the build machine and re-deploy.

## CI

The packager is designed to run unattended:

```powershell
$env:CI = '1'
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-windows.ps1
```

Cache `dist/node-cache/` between runs to skip the Node.js download.

## Updating an existing install

Re-running `install.ps1 -Force` from a newer ZIP overwrites `app/`, `node/`,
and the helper scripts but leaves `.env` and the data directory untouched.
The user keeps their accounts, settings, and SQLite history.
