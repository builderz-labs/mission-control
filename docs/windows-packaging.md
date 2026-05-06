# Windows Packaging

Mission Control ships as a portable Windows ZIP that bundles the prebuilt
Next.js standalone app, a portable Node.js runtime, and a PowerShell installer.
The result is a single file you can copy to any Windows 10/11 machine, extract,
and run — no Node.js, pnpm, or admin rights required on the target.

## Build a release

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
