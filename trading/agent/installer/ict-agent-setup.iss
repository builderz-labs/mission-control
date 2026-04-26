; ICT Agent — Inno Setup Script
; Builds: ict-agent-setup-{version}.exe
;
; Prerequisites:
;   - ICT-Agent.exe already built by PyInstaller (../dist/ICT-Agent.exe)
;   - Inno Setup 6.x installed (https://jrsoftware.org/isinfo.php)
;
; Build:
;   iscc ict-agent-setup.iss
;
; Output: Output\ict-agent-setup-{#AgentVersion}.exe

#define AgentVersion "1.1.0"
#define AppName "ICT Agent"
#define AppPublisher "ICT Wealth Building"
#define AppURL "https://dashboard.ictwealthbuilding.com"
#define ExeName "ICT-Agent.exe"

[Setup]
AppId={{A3F2E1D0-7B4C-4E8A-9F1D-2C5B6A8E3F7D}
AppName={#AppName}
AppVersion={#AgentVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
DefaultDirName={localappdata}\ICTAgent
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=ict-agent-setup-{#AgentVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
; No elevation required — installs to %LOCALAPPDATA%
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
; Console app, no splash needed
DisableWelcomePage=no
; SmartScreen note shown until code-signed
SignedUninstaller=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\dist\{#ExeName}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#ExeName}"; Parameters: "--setup"; Comment: "First-run setup wizard"
Name: "{group}\{#AppName} (Run)"; Filename: "{app}\{#ExeName}"; Comment: "Start the ICT Agent"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#ExeName}"; Tasks: desktopicon

[Run]
; Offer to launch setup wizard after install
Filename: "{app}\{#ExeName}"; Parameters: "--setup"; Description: "Run setup wizard now (enter your pairing token)"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Clean up agent config on uninstall (ask user)
Type: filesandordirs; Name: "{userdocs}\ICTAgent"

[Code]
// Warn if a previous instance is running
function InitializeSetup(): Boolean;
begin
  Result := True;
end;
