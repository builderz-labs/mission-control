Mission Control - Windows Portable Package
===========================================

This ZIP contains everything Mission Control needs to run on a Windows 10/11
machine: the prebuilt application, a portable Node.js runtime, and helper
scripts. Nothing is installed system-wide; uninstalling is a single command.

QUICK START
-----------
1. Extract this ZIP somewhere convenient (e.g. Desktop).
2. Right-click `install.ps1` -> "Run with PowerShell"
   ...or open PowerShell in this folder and run:

       powershell -ExecutionPolicy Bypass -File .\install.ps1

3. The installer will:
     - Copy files to %LOCALAPPDATA%\MissionControl
     - Generate a fresh .env with random AUTH_SECRET and API_KEY
     - Start the server on http://127.0.0.1:3000
     - Open the setup page in your browser so you can create the admin user

That's it. Bookmark http://127.0.0.1:3000 and you're done.

OPTIONS
-------
Run install.ps1 with one or more of these flags:

  -InstallDir <path>   Custom install location.
  -DataDir    <path>   Where the SQLite DB and runtime data live.
                       Default: <InstallDir>\data
  -Port       <n>      TCP port. Default: 3000.
  -Hostname   <addr>   Bind address. Default: 127.0.0.1 (loopback only).
                       Use 0.0.0.0 to expose on the LAN.
  -AutoStart           Register a Scheduled Task that launches Mission
                       Control automatically when you log in.
  -NoLaunch            Install only; don't start the server.
  -Force               Overwrite existing install files (data is preserved).

Example - install to D:\Apps\MC, expose on the LAN, autostart:

  powershell -ExecutionPolicy Bypass -File .\install.ps1 `
      -InstallDir D:\Apps\MC -Hostname 0.0.0.0 -AutoStart

DAY-TO-DAY
----------
After install, all the helper scripts live in the install directory:

  Start.bat                              Run the server in the foreground.
  powershell -File Stop.ps1              Stop the running server.
  powershell -File Uninstall.ps1         Remove the install (preserves data).
  powershell -File Uninstall.ps1 `
      -DeleteData                        Remove install AND data.

The .env file in the install directory is the source of truth for runtime
configuration. Edit it freely and restart with Start.bat.

WHAT GETS INSTALLED
-------------------
  <InstallDir>\
      app\                Next.js standalone build (the application).
      node\               Portable Node.js runtime (only this Mission Control
                          install uses it).
      data\               SQLite database, tokens, backups (default DataDir).
      launcher.js         Bootstrap that loads .env and starts server.js.
      Start.bat           Launches the server.
      Stop.ps1            Stops the server.
      Uninstall.ps1       Removes the install.
      .env                Generated on first install.
      .env.example        Reference template.

Nothing is added to the registry, PATH, or Windows services. Only the
optional Scheduled Task ("MissionControl") is system-visible, and -AutoStart
is opt-in.

TROUBLESHOOTING
---------------
- Port 3000 already in use: re-run install.ps1 with -Port 3001 (or another
  free port). The previous .env is preserved unless you delete it.
- Browser shows "can't reach": check Start.bat's window - the standalone
  server prints any startup errors there. Common causes are a stale
  better-sqlite3 binary (mismatched Node ABI) or a port conflict.
- Forgot the admin password: stop the server, delete <DataDir>\mission-control.db,
  start again, and visit /setup to recreate the admin.
