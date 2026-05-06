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
RestartApplicationsIfPossible=no

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
const
  PROV_RSA_FULL = 1;
  CRYPT_VERIFYCONTEXT = $F0000000;

function CryptAcquireContext(var phProv: DWORD; pszContainer: PAnsiChar;
  pszProvider: PAnsiChar; dwProvType, dwFlags: DWORD): BOOL;
  external 'CryptAcquireContextA@advapi32.dll stdcall';
function CryptReleaseContext(hProv: DWORD; dwFlags: DWORD): BOOL;
  external 'CryptReleaseContext@advapi32.dll stdcall';
function CryptGenRandom(hProv: DWORD; dwLen: DWORD; pbBuffer: AnsiString): BOOL;
  external 'CryptGenRandom@advapi32.dll stdcall';

function GenerateRandomHex(NumBytes: Integer): String;
var
  hProv: DWORD;
  Buffer: AnsiString;
  i: Integer;
  HexChars: String;
  B: Integer;
begin
  Result := '';
  HexChars := '0123456789abcdef';
  Buffer := StringOfChar(#0, NumBytes);
  if not CryptAcquireContext(hProv, nil, nil, PROV_RSA_FULL, CRYPT_VERIFYCONTEXT) then
    Exit;
  try
    if not CryptGenRandom(hProv, NumBytes, Buffer) then Exit;
    for i := 1 to NumBytes do
    begin
      B := Ord(Buffer[i]);
      Result := Result + HexChars[(B shr 4) + 1] + HexChars[(B and $F) + 1];
    end;
  finally
    CryptReleaseContext(hProv, 0);
  end;
end;

procedure WriteEnvFile(InstallDir: String);
var
  EnvPath: String;
  Lines: TArrayOfString;
  AuthSecret: String;
  ApiKey: String;
  DataDir: String;
begin
  EnvPath := InstallDir + '\.env';
  if FileExists(EnvPath) then
  begin
    Log('Skipping .env generation: file already exists at ' + EnvPath);
    Exit;
  end;

  AuthSecret := GenerateRandomHex(32);
  ApiKey := GenerateRandomHex(32);
  DataDir := InstallDir + '\data';
  ForceDirectories(DataDir);

  if (AuthSecret = '') or (ApiKey = '') then
  begin
    Log('CryptGenRandom failed; skipping .env generation. Run install.ps1 manually to seed secrets.');
    Exit;
  end;

  SetArrayLength(Lines, 11);
  Lines[0] := '# Mission Control runtime configuration.';
  Lines[1] := '# Generated by Inno Setup on first install. Edit freely.';
  Lines[2] := '';
  Lines[3] := 'PORT=3000';
  Lines[4] := 'MC_HOSTNAME=127.0.0.1';
  Lines[5] := 'AUTH_SECRET=' + AuthSecret;
  Lines[6] := 'API_KEY=' + ApiKey;
  Lines[7] := 'MISSION_CONTROL_DATA_DIR=' + DataDir;
  Lines[8] := 'MC_COOKIE_SAMESITE=strict';
  Lines[9] := 'MC_ALLOWED_HOSTS=localhost,127.0.0.1,::1';
  Lines[10] := 'NEXT_PUBLIC_GATEWAY_OPTIONAL=true';

  if not SaveStringsToFile(EnvPath, Lines, False) then
    Log('Failed to write .env at ' + EnvPath);
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
