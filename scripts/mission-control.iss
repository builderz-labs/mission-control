; Mission Control - Inno Setup script
;
; Produces dist/MissionControl-Setup-<version>.exe by wrapping the staged
; bundle that scripts/package-windows.ps1 already builds at
; dist/mission-control-windows/.
;
; Build with scripts/build-installer.ps1 (handles ISCC location, version
; defines, sanity checks). Or directly:
;     ISCC.exe /DMyAppVersion=2.0.1 scripts/mission-control.iss
;
; Requires Inno Setup 6+. Install via: winget install JRSoftware.InnoSetup

#ifndef MyAppVersion
  #define MyAppVersion "2.0.1"
#endif
#ifndef StageDir
  #define StageDir "..\dist\mission-control-windows"
#endif
#ifndef OutputDir
  #define OutputDir "..\dist"
#endif

#define MyAppName "Mission Control"
#define MyAppPublisher "builderz-labs"
#define MyAppURL "https://github.com/builderz-labs/mission-control"
#define MyAppExeName "Start.bat"

[Setup]
; A unique, stable AppId so upgrades replace the previous install instead of
; creating a second entry in Apps & Features.
AppId={{B33A7C4E-19E4-4A2F-8F71-6E5C9F2D4A91}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
VersionInfoVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={localappdata}\MissionControl
DisableDirPage=no
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=MissionControl-Setup-{#MyAppVersion}
Compression=lzma2/ultra
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\app\public\mc.png
UninstallDisplayName={#MyAppName}
SetupIconFile=
WizardSmallImageFile=
CloseApplications=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "autostart"; Description: "Start {#MyAppName} automatically when I sign in"; GroupDescription: "Startup:"
Name: "openbrowser"; Description: "Open Mission Control in my browser after install"; GroupDescription: "After install:"; Flags: unchecked

[Files]
; Pull every file from the staged bundle. excludes: drop the helper scripts
; we don't need post-install (install.ps1 is for ZIP users; we already ran
; its logic via [Code]).
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "install.ps1,packager-run.log"

[Icons]
Name: "{group}\Mission Control"; Filename: "{app}\Start.bat"; WorkingDir: "{app}"; Comment: "Launch Mission Control"
Name: "{group}\Open Mission Control in browser"; Filename: "http://127.0.0.1:3000/"
Name: "{group}\Stop Mission Control"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\Stop.ps1"""; WorkingDir: "{app}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\Mission Control"; Filename: "http://127.0.0.1:3000/"; Tasks: "openbrowser"

[Run]
; Start the server in the background. /B keeps the cmd window from showing.
Filename: "{cmd}"; Parameters: "/C start """" /B ""{app}\Start.bat"""; WorkingDir: "{app}"; Flags: runhidden nowait; Description: "Start Mission Control"; StatusMsg: "Starting Mission Control..."
; Open the setup page if the user opted in. The browser open is fire-and-forget.
Filename: "http://127.0.0.1:3000/setup"; Tasks: "openbrowser"; Flags: shellexec nowait postinstall skipifsilent; Description: "Open Mission Control in browser"

[UninstallRun]
; Stop the server before removing files.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\Stop.ps1"""; WorkingDir: "{app}"; Flags: runhidden; RunOnceId: "StopMissionControl"
; Remove the scheduled task if we registered one.
Filename: "schtasks.exe"; Parameters: "/Delete /TN MissionControl /F"; Flags: runhidden; RunOnceId: "RemoveAutostartTask"

[UninstallDelete]
; Clean up generated artifacts but preserve the data directory by default.
Type: files; Name: "{app}\.env"
Type: files; Name: "{app}\launcher-test.log"

[Code]
// Generate the .env file with random secrets via PowerShell. Inno Setup's
// Pascal Script doesn't have a native DWORD type so calling CryptGenRandom
// via DLL-import is awkward; shelling out to PowerShell is simpler and
// uses the same crypto under the hood.
procedure WriteEnvFile(InstallDir: String);
var
  EnvPath: String;
  PsCmd: String;
  PsArgs: String;
  ResultCode: Integer;
  DataDir: String;
begin
  EnvPath := InstallDir + '\.env';
  if FileExists(EnvPath) then
  begin
    Log('Skipping .env generation: file already exists at ' + EnvPath);
    Exit;
  end;

  DataDir := InstallDir + '\data';
  ForceDirectories(DataDir);

  // PowerShell one-liner: generate two 32-byte hex secrets via
  // RandomNumberGenerator and write a UTF-8 .env file.
  PsCmd := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  PsArgs :=
    '-NoProfile -ExecutionPolicy Bypass -Command "' +
    '$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create(); ' +
    '$buf = [byte[]]::new(32); ' +
    '$rng.GetBytes($buf); ' +
    '$auth = -join ($buf | ForEach-Object { $_.ToString(''x2'') }); ' +
    '$rng.GetBytes($buf); ' +
    '$api = -join ($buf | ForEach-Object { $_.ToString(''x2'') }); ' +
    '$lines = @(' +
    '''# Mission Control runtime configuration.''' + ',' +
    '''# Generated by Inno Setup on first install. Edit freely.''' + ',' +
    '''''' + ',' +
    '''PORT=3000''' + ',' +
    '''MC_HOSTNAME=127.0.0.1''' + ',' +
    '''AUTH_SECRET='' + $auth' + ',' +
    '''API_KEY='' + $api' + ',' +
    '''MISSION_CONTROL_DATA_DIR=' + DataDir + '''' + ',' +
    '''MC_COOKIE_SAMESITE=strict''' + ',' +
    '''MC_ALLOWED_HOSTS=localhost,127.0.0.1,::1''' + ',' +
    '''NEXT_PUBLIC_GATEWAY_OPTIONAL=true''' +
    '); ' +
    'Set-Content -LiteralPath ''' + EnvPath + ''' -Value $lines -Encoding utf8' +
    '"';

  if not Exec(PsCmd, PsArgs, InstallDir, SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    Log('Failed to launch PowerShell to generate .env')
  else if ResultCode <> 0 then
    Log('PowerShell .env generation returned exit code ' + IntToStr(ResultCode))
  else if not FileExists(EnvPath) then
    Log('PowerShell completed but .env was not created at ' + EnvPath)
  else
    Log('Generated .env at ' + EnvPath);
end;

procedure RegisterAutostartTask(InstallDir: String);
var
  Cmd: String;
  Args: String;
  ResultCode: Integer;
begin
  // schtasks /Create runs as the current interactive user without admin and
  // launches at logon. /F overwrites if the task exists.
  Cmd := ExpandConstant('{sys}\schtasks.exe');
  Args := '/Create /TN MissionControl /SC ONLOGON /TR "\"' + InstallDir + '\Start.bat\"" /F';
  if not Exec(Cmd, Args, InstallDir, SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    Log('schtasks /Create failed to launch')
  else if ResultCode <> 0 then
    Log('schtasks /Create returned exit code ' + IntToStr(ResultCode));
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  AppDir: String;
begin
  if CurStep = ssPostInstall then
  begin
    AppDir := ExpandConstant('{app}');
    WriteEnvFile(AppDir);
    if WizardIsTaskSelected('autostart') then
      RegisterAutostartTask(AppDir);
  end;
end;
