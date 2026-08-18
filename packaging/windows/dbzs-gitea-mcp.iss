#define AppName "DBZS Gitea MCP Server"
#define AppVersion "0.4.0"
#define AppPublisher "Division By Zeros"
#define AppIcoName "dbzs-gitea-mcp.ico"

[Setup]
AppId={{9FA3162F-CE62-4107-B767-342AFCCFEEEF}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\DBZS\Gitea MCP
DefaultGroupName=DBZS\Gitea MCP
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\dist\installer
OutputBaseFilename=DBZS-Gitea-MCP-Setup-{#AppVersion}
SetupIconFile=..\..\installer\dbzs-gitea-mcp-installer.ico
UninstallDisplayIcon={app}\{#AppIcoName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
ChangesEnvironment=yes
VersionInfoVersion={#AppVersion}.0
VersionInfoCompany={#AppPublisher}
VersionInfoDescription=DBZS Gitea MCP Server Windows Installer
VersionInfoProductName={#AppName}

[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "service"; Description: "Als Windows-Dienst installieren und automatisch starten (HTTP-Loopback-Transport, 127.0.0.1)"; GroupDescription: "Systemintegration:"; Flags: unchecked

[Files]
Source: "..\..\dist-package\dist\*"; DestDir: "{app}\dist"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\dist-package\node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\dist-package\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\dist-package\package-lock.json"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\..\dist-package\service\*"; DestDir: "{app}\service"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\.env.example"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\DBZS Gitea MCP Server.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\app\windows\dbzs-gitea-mcp.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\tray\windows\dbzs-gitea-mcp-tray.ico"; DestDir: "{app}\assets"; Flags: ignoreversion
Source: "..\..\favicon\favicon.ico"; DestDir: "{app}\assets"; Flags: ignoreversion
Source: "..\..\favicon\apple-touch-icon.png"; DestDir: "{app}\assets"; Flags: ignoreversion

[Registry]
Root: HKLM; Subkey: "SYSTEM\CurrentControlSet\Control\Session Manager\Environment"; ValueType: string; ValueName: "GITEA_BASE_URL"; ValueData: "http://127.0.0.1:3000"; Tasks: service
Root: HKLM; Subkey: "SYSTEM\CurrentControlSet\Control\Session Manager\Environment"; ValueType: string; ValueName: "GITEA_ALLOWED_OWNER"; ValueData: "devdbzemusic"; Tasks: service

[Icons]
Name: "{group}\Dokumentation"; Filename: "{app}\DBZS Gitea MCP Server.md"; IconFilename: "{app}\{#AppIcoName}"
Name: "{group}\Beispiel MCP-Client-Konfiguration"; Filename: "{app}\mcp-client-config.example.json"
Name: "{group}\Installationsordner"; Filename: "{app}"
Name: "{group}\{cm:UninstallProgram,DBZS Gitea MCP Server}"; Filename: "{uninstallexe}"

[Run]
Filename: "node.exe"; Parameters: """{app}\service\service-install.js"""; WorkingDir: "{app}\service"; StatusMsg: "DBZS Gitea MCP Windows-Dienst wird installiert..."; Flags: runhidden waituntilterminated; Tasks: service

[UninstallRun]
Filename: "node.exe"; Parameters: """{app}\service\service-uninstall.js"""; WorkingDir: "{app}\service"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveGiteaMcpService"; Tasks: service

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\sc.exe'), 'stop DBZS.GiteaMCP', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  ResultCode: Integer;
  NodeFound: Boolean;
begin
  Result := True;
  if (CurPageID = wpSelectTasks) and WizardIsTaskSelected('service') then
  begin
    NodeFound := Exec('cmd.exe', '/C node --version', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
    if not NodeFound then
    begin
      MsgBox('Node.js (>= 24) wurde nicht gefunden. Bitte Node.js installieren, bevor der Dienst ' +
        'eingerichtet wird, oder die Aufgabe "Als Windows-Dienst installieren" abwaehlen.',
        mbError, MB_OK);
      Result := False;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigPath, IndexPath, JsonContent: String;
begin
  if CurStep = ssPostInstall then
  begin
    IndexPath := ExpandConstant('{app}\dist\index.js');
    StringChangeEx(IndexPath, '\', '\\', True);
    ConfigPath := ExpandConstant('{app}\mcp-client-config.example.json');
    JsonContent :=
      '{' + #13#10 +
      '  "mcpServers": {' + #13#10 +
      '    "dbzs-gitea": {' + #13#10 +
      '      "command": "node",' + #13#10 +
      '      "args": ["' + IndexPath + '"],' + #13#10 +
      '      "env": {' + #13#10 +
      '        "GITEA_BASE_URL": "http://127.0.0.1:3000",' + #13#10 +
      '        "GITEA_ALLOWED_OWNER": "devdbzemusic"' + #13#10 +
      '      }' + #13#10 +
      '    }' + #13#10 +
      '  }' + #13#10 +
      '}';
    SaveStringToFile(ConfigPath, JsonContent, False);
    Log('DBZS Gitea MCP installiert unter: ' + ExpandConstant('{app}'));

    if WizardIsTaskSelected('service') then
    begin
      MsgBox('Der Windows-Dienst "DBZS.GiteaMCP" wurde eingerichtet, laeuft aber erst nach ' +
        'einem gueltigen Token. Setzen Sie DBZS_HOME_API_TOKEN als Systemumgebungsvariable ' +
        '(z. B. ueber "Umgebungsvariablen fuer dieses System bearbeiten" oder ' +
        'setx /M DBZS_HOME_API_TOKEN "<token>") und starten Sie den Dienst anschliessend ueber ' +
        'services.msc oder "sc start DBZS.GiteaMCP" neu. Der Token wird von diesem Installer ' +
        'nie automatisch gesetzt oder in einer Datei gespeichert.',
        mbInformation, MB_OK);
    end;
  end;
end;
