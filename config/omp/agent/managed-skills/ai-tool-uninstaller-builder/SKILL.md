---
name: ai-tool-uninstaller-builder
description: "Use when researching and building cross-platform Windows (.bat, .ps1) and macOS (.sh) deep uninstaller script suites for AI coding agents, CLIs, and desktop apps."
---

# AI Tool Deep-Uninstaller Builder (Windows & macOS)

Standardized workflow for researching and building complete 3-file uninstaller suites (`uninstall_<name>.bat`, `uninstall_<name>.ps1`, `uninstall_<name>.sh`) for AI Desktop/CLI/IDE tools on Windows and macOS.

## 1. Mandatory Encoding & Output Invariants

- **100% 7-bit ASCII (`nonAsciiCount === 0`)**: Write all comments and `Write-Host` / `echo` messages in **unaccented Vietnamese (`Tieng Viet khong dau`)**. Never use Vietnamese diacritics, Unicode arrows/checkmarks (`▶`, `✓`), or emojis (`🎉`) to prevent console mojibake and PowerShell 5.1 parser errors.
- **Standard Status Prefixes**:
  - Section headers: `[>] 1. ...`
  - Success actions: `  [OK] Da xoa: ...`
  - Sub-steps: `  [-] Dang ...`
  - Warnings: `  [!] ...`
  - Dry-run items: `  [DRY-RUN] Phat hien ...` or `  [DRY-RUN] Se xoa: ...`
- **Line Endings**:
  - `uninstall_<name>.bat`: `CRLF` (`\r\n`), no BOM.
  - `uninstall_<name>.ps1`: `CRLF` (`\r\n`), no BOM (pure ASCII).
  - `uninstall_<name>.sh`: `LF` (`\n`), no BOM.

## 2. Windows `.bat` Launcher & UAC Self-Elevation Rules

- Always start `uninstall_<name>.bat` with:
  ```bat
  @echo off
  setlocal EnableExtensions DisableDelayedExpansion
  chcp 65001 >nul 2>&1
  cd /d "%~dp0"
  ```
  (`ShellExecuteEx` `"runas"` resets the elevated `cmd.exe` working directory to `C:\Windows\System32` unless `cd /d "%~dp0"` is at the top of the `.bat` file).
- **Never pass `-ArgumentList '%*'` unconditionally to `Start-Process`**: in Windows PowerShell 5.1, `-ArgumentList` has `[ValidateNotNullOrEmpty()]`, so running the `.bat` with no arguments (`%*` empty -> `-ArgumentList ''`) throws `ParameterBindingValidationException` and aborts before UAC elevation.
- Pass the script path and normalized arguments via environment variables (`BAT_SELF`, `BAT_ARGS`) and branch on `[string]::IsNullOrWhiteSpace($env:BAT_ARGS)` before passing `-ArgumentList`.

## 3. Parallel Discovery Phase (Online + Local Read-Only Audit)

Before writing scripts, run parallel read-only discovery:
1. **Online Source & Installer Audit**:
   - Inspect official `install.ps1` / `install.sh`, Homebrew Cask/Formula (`Casks/*.rb`), WinGet manifests, Electron Builder / Tauri configs (`appId`, `productName`, updater cache name).
   - Identify built-in self-uninstall/logout CLI commands (e.g., `<tool> auth logout`, `<tool> service stop`, `<tool> uninstall --force`).
2. **Local System Footprint Audit (Read-Only)**:
   - Check `%LOCALAPPDATA%`, `%APPDATA%`, `%USERPROFILE%` dotfiles (`.<tool>`), and XDG directories on Windows (`%USERPROFILE%\.config`, `.local\share`, `.local\state`, `.cache`).
   - Check **all Node version managers** (`%APPDATA%\nvm\v*`, `$env:NVM_SYMLINK` / `C:\Program Files\nodejs`, `fnm`, `Volta`, `.bun\bin`, `pnpm`) because `npm uninstall -g` only cleans the active Node version.
   - Check injected hooks/plugins/skills in external AI agents and IDE extensions (`.vscode`, `.cursor`, `.windsurf`, `globalStorage`).

## 4. 9-Step Uninstaller Architecture & PowerShell 5.1 Safety Invariants

Both `uninstall_<name>.ps1` and `uninstall_<name>.sh` MUST implement:
1. **Parameters / Flags**: `-DryRun` (`--dry-run`, `/dryrun`), `-SkipRecycleBin` (`--skip-trash`), plus tool-specific preservation flags.
2. **Step 1 — Graceful Logout, Service Teardown & Process Termination**:
   - Invoke built-in CLI logout/service stop/uninstall with a bounded timeout (`Invoke-CommandWithTimeout`).
   - Unload macOS `LaunchAgents` (`launchctl bootout`).
   - Walk all ancestor PIDs from `$PID` up to root (max 32 hops) and explicitly exclude host shells/terminals/IDEs (`cmd.exe`, `powershell.exe`, `pwsh.exe`, `conhost.exe`, `WindowsTerminal.exe`, `OpenConsole.exe`, `explorer.exe`, `Code.exe`, `Cursor.exe`, `Windsurf.exe`) when killing processes via `Win32_Process`.
3. **Step 2 — Desktop Application Removal**:
   - WinGet (`--disable-interactivity`), AppX/MSIX, Homebrew Cask/Formula, silent NSIS/InnoSetup/Squirrel uninstallers (`/S`, `/VERYSILENT`, `--uninstall -s`), install directories, Desktop/Start Menu shortcuts, and macOS `pkgutil --forget`.
4. **Step 3 — Multi-Runtime CLI Removal**:
   - Package managers (`npm`, `pnpm`, `yarn`, `bun`, `volta`, `pip`, `pip3`, `pipx`, `uv`, `scoop`, `choco`, `cargo`, `mise`).
   - Direct sweep across all `nvm` (`%APPDATA%\nvm\v*` / `~/.nvm/versions/node/v*`), `fnm`, and `Volta` roots to remove leftover `node_modules/<pkg>` and shims.
5. **Step 4 — IDE Extensions & External Agent Hooks/Skills**:
   - Uninstall VS Code / Cursor / Windsurf / VSCodium / Zed extensions.
   - When rewriting JSON arrays (e.g., `extensions.json`) or shell profiles (`.bashrc`, `.zshrc`) in PowerShell 5.1, preserve `[...]` for 0/1-element arrays and write with `[System.Text.UTF8Encoding]::new($false)` (never `Set-Content -Encoding UTF8`, which adds a 3-byte BOM).
6. **Step 5 — Deep Data, XDG, Updater & Cache Purge**:
   - Use `Remove-SafeItem` (with ReparsePoint safe delete and `icacls /reset` + `attrib -r -s -h` fallback for ACL-locked folders).
   - For shared caches (such as Microsoft Office `16.0\Wef`), surgically target only the tool's specific GUIDs/Asset IDs/domains rather than wiping unrelated add-ins.
7. **Step 6 — Credentials, Firewall & Registry / Keychain**:
   - Windows Credential Manager (`cmdkey`), Registry (`Uninstall`, `Software\Classes` URL protocols, `AppUserModelId`, `Run`), or macOS `security delete-generic-password`. Format `PSPath` values (`Microsoft.PowerShell.Core\Registry::...`) to `HKCU:` / `HKLM:` before logging.
8. **Step 7 — Environment Variables & Shell Profiles**:
   - Read unexpanded `Path` via `$regKey.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)` and write back with `Set-ItemProperty -Type ExpandString` so `%SystemRoot%` / `REG_EXPAND_SZ` is never corrupted into `REG_SZ`.
9. **Step 8 & 9 — Recycle Bin / Trash & Post-Uninstall Verification**:
   - Verify `where.exe` / `command -v`, key directories, credentials, and services are gone.

## 5. Mandatory Verification Gate

Before finishing, validate via `eval` and `bash`:
1. Confirm `nonAsciiCount === 0`, no UTF-8 BOM, and proper line endings (`CRLF` for `.bat`/`.ps1`, `LF` for `.sh`).
2. Parse `.ps1` via `[System.Management.Automation.Language.Parser]::ParseFile` (`0` errors).
3. Check `.sh` via `bash -n` (`0` errors).
4. Execute `uninstall_<name>.bat --dry-run`, `powershell -File uninstall_<name>.ps1 -DryRun`, and `bash uninstall_<name>.sh --dry-run`.
