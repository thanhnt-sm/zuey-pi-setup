"""
uninstaller_builder.py — 9-Step Cross-OS 7-bit ASCII Deep Uninstaller Generator.

Produces 3 production-hardened scripts in `--output`:
- `uninstall_<slug>.bat` (CRLF, 7-bit ASCII, no BOM, `cd /d "%~dp0"`, BAT_SELF/BAT_ARGS UAC elevation)
- `uninstall_<slug>.ps1` (CRLF, 7-bit ASCII, no BOM, ancestor PID protection, REG_EXPAND_SZ PATH edit)
- `uninstall_<slug>.sh`  (LF,   7-bit ASCII, no BOM, launchctl bootout, nvm/fnm/volta/brew/Keychain)
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, Union


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", name.strip().lower()).strip("-")
    if not slug:
        raise ValueError("Tool name must contain alphanumeric characters")
    return slug


def _assert_ascii(text: str, label: str) -> str:
    if not text.isascii():
        bad = [ch for ch in text if ord(ch) >= 128][:5]
        raise ValueError(f"Generated {label} contains non-ASCII chars: {bad}")
    return text


def generate_uninstaller_suite(tool_name: str, output_dir: Union[str, Path], package_id: str = "") -> Dict[str, str]:
    slug = _slugify(tool_name)
    pkg = re.sub(r"[^a-zA-Z0-9._/@-]+", "", package_id or slug)
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    bat_name = f"uninstall_{slug}.bat"
    ps1_name = f"uninstall_{slug}.ps1"
    sh_name = f"uninstall_{slug}.sh"

    bat_src = _assert_ascii(
        "@echo off\r\n"
        "setlocal EnableExtensions DisableDelayedExpansion\r\n"
        "chcp 65001 >nul 2>&1\r\n"
        'cd /d "%~dp0"\r\n'
        f'set "TARGET_PS1=%~dp0{ps1_name}"\r\n'
        'if not exist "%TARGET_PS1%" ( echo [!] Missing %TARGET_PS1% & exit /b 1 )\r\n'
        'set "BAT_SELF=%~f0"\r\n'
        'set "BAT_ARGS=%*"\r\n'
        "net session >nul 2>&1\r\n"
        "if %errorLevel% NEQ 0 (\r\n"
        "  echo [>] Requesting UAC elevation...\r\n"
        '  powershell -NoProfile -Command "$a=$env:BAT_ARGS; if ([string]::IsNullOrWhiteSpace($a)) { Start-Process -FilePath $env:BAT_SELF -Verb RunAs } else { Start-Process -FilePath $env:BAT_SELF -ArgumentList $a -Verb RunAs }"\r\n'
        "  exit /b %errorLevel%\r\n"
        ")\r\n"
        'powershell -NoProfile -ExecutionPolicy Bypass -File "%TARGET_PS1%" %*\r\n'
        "exit /b %errorLevel%\r\n",
        bat_name,
    )

    ps1_src = _assert_ascii(
        f"<#\r\n9-Step Deep Uninstaller for {slug} (7-bit ASCII, PowerShell 5.1 safe)\r\n#>\r\n"
        "param(\r\n"
        "  [switch]$DryRun,\r\n"
        "  [switch]$SkipRecycleBin\r\n"
        ")\r\n"
        "$ErrorActionPreference = 'Continue'\r\n"
        f"$ToolSlug = '{slug}'\r\n"
        f"$PkgName  = '{pkg}'\r\n"
        "function Remove-SafeItem([string]$Target) {\r\n"
        "  if (-not (Test-Path -LiteralPath $Target)) { return }\r\n"
        "  if ($DryRun) { Write-Host \"  [DRY-RUN] Se xoa: $Target\"; return }\r\n"
        "  try { Remove-Item -LiteralPath $Target -Recurse -Force -ErrorAction Stop; Write-Host \"  [OK] Da xoa: $Target\" }\r\n"
        "  catch { Write-Host \"  [!] Bo qua (locked): $Target\" }\r\n"
        "}\r\n"
        "Write-Host \"[>] 1. Dung tien trinh lien quan $ToolSlug (bao ve ancestor shells)...\"\r\n"
        "$ancestors = New-Object 'System.Collections.Generic.HashSet[int]'\r\n"
        "$curPid = $PID\r\n"
        "for ($i=0; $i -lt 32 -and $curPid -gt 0; $i++) {\r\n"
        "  [void]$ancestors.Add($curPid)\r\n"
        "  $pObj = Get-CimInstance Win32_Process -Filter \"ProcessId=$curPid\" -ErrorAction SilentlyContinue\r\n"
        "  if (-not $pObj) { break }\r\n"
        "  $curPid = [int]$pObj.ParentProcessId\r\n"
        "}\r\n"
        "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $ToolSlug -and -not $ancestors.Contains([int]$_.ProcessId) } | ForEach-Object {\r\n"
        "  if ($DryRun) { Write-Host \"  [DRY-RUN] Se dung PID $($_.ProcessId) ($($_.Name))\" }\r\n"
        "  else { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host \"  [OK] Da dung PID $($_.ProcessId)\" }\r\n"
        "}\r\n"
        "Write-Host \"[>] 2. Go Desktop/WinGet package...\"\r\n"
        "if ((Get-Command winget -ErrorAction SilentlyContinue) -and -not $DryRun) { winget uninstall --id $PkgName --silent --disable-interactivity 2>$null | Out-Null }\r\n"
        "Write-Host \"[>] 3. Quet Node (nvm/fnm/volta/bun/npm) & Python CLIs...\"\r\n"
        "foreach ($mgr in @('npm','pnpm','bun')) {\r\n"
        "  if (Get-Command $mgr -ErrorAction SilentlyContinue) {\r\n"
        "    if ($DryRun) { Write-Host \"  [DRY-RUN] Se go goi $PkgName qua $mgr\" }\r\n"
        "    else { & $mgr uninstall -g $PkgName 2>$null | Out-Null }\r\n"
        "  }\r\n"
        "}\r\n"
        "if (Test-Path \"$env:APPDATA\\nvm\") {\r\n"
        "  Get-ChildItem \"$env:APPDATA\\nvm\" -Directory -ErrorAction SilentlyContinue | ForEach-Object {\r\n"
        "    Remove-SafeItem (Join-Path $_.FullName \"node_modules\\$PkgName\")\r\n"
        "  }\r\n"
        "}\r\n"
        "Write-Host \"[>] 4-5. Xoa thu muc cau hinh, XDG, cache...\"\r\n"
        "foreach ($dir in @(\"$env:USERPROFILE\\.$ToolSlug\", \"$env:APPDATA\\$ToolSlug\", \"$env:LOCALAPPDATA\\$ToolSlug\", \"$env:USERPROFILE\\.config\\$ToolSlug\", \"$env:USERPROFILE\\.cache\\$ToolSlug\")) {\r\n"
        "  Remove-SafeItem $dir\r\n"
        "}\r\n"
        "Write-Host \"[>] 6-7. Kiem tra PATH (REG_EXPAND_SZ)...\"\r\n"
        "$envKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)\r\n"
        "if ($envKey) {\r\n"
        "  $rawPath = $envKey.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)\r\n"
        "  if ($rawPath -and $rawPath -match [regex]::Escape($ToolSlug)) {\r\n"
        "    $kept = ($rawPath -split ';') | Where-Object { $_ -and ($_ -notmatch [regex]::Escape($ToolSlug)) }\r\n"
        "    if ($DryRun) { Write-Host '  [DRY-RUN] Se don PATH user (giu REG_EXPAND_SZ)' }\r\n"
        "    else { $envKey.SetValue('Path', ($kept -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString); Write-Host '  [OK] Da cap nhat PATH' }\r\n"
        "  }\r\n"
        "  $envKey.Close()\r\n"
        "}\r\n"
        "Write-Host \"[>] 8-9. Hoan tat kiem tra go bo $ToolSlug.\"\r\n",
        ps1_name,
    )

    sh_src = _assert_ascii(
        "#!/usr/bin/env bash\n"
        f"# 9-Step Deep Uninstaller for {slug} on macOS / Linux (7-bit ASCII)\n"
        "set -u\n"
        "DRY_RUN=0\n"
        "for arg in \"$@\"; do\n"
        "  case \"$arg\" in\n"
        "    --dry-run|-d) DRY_RUN=1 ;;\n"
        "  esac\n"
        "done\n"
        f"TOOL_SLUG=\"{slug}\"\n"
        f"PKG_NAME=\"{pkg}\"\n"
        "rm_safe() {\n"
        "  local tgt=\"$1\"\n"
        "  [ -e \"$tgt\" ] || [ -L \"$tgt\" ] || return 0\n"
        "  if [ \"$DRY_RUN\" -eq 1 ]; then\n"
        "    echo \"  [DRY-RUN] Se xoa: $tgt\"\n"
        "  else\n"
        "    rm -rf \"$tgt\" && echo \"  [OK] Da xoa: $tgt\"\n"
        "  fi\n"
        "}\n"
        "echo \"[>] 1. Dung service / LaunchAgents / process $TOOL_SLUG...\"\n"
        "if [ \"$(uname -s)\" = \"Darwin\" ] && [ -d \"$HOME/Library/LaunchAgents\" ]; then\n"
        "  for plist in \"$HOME/Library/LaunchAgents\"/*\"$TOOL_SLUG\"*.plist; do\n"
        "    [ -e \"$plist\" ] || continue\n"
        "    if [ \"$DRY_RUN\" -eq 1 ]; then echo \"  [DRY-RUN] Se unload $plist\"; else launchctl bootout \"gui/$(id -u)\" \"$plist\" 2>/dev/null || true; rm_safe \"$plist\"; fi\n"
        "  done\n"
        "fi\n"
        "echo \"[>] 2. Kiem tra Homebrew Cask/Formula...\"\n"
        "if command -v brew >/dev/null 2>&1; then\n"
        "  if [ \"$DRY_RUN\" -eq 1 ]; then echo \"  [DRY-RUN] Se kiem tra brew uninstall $PKG_NAME\"; else brew uninstall \"$PKG_NAME\" 2>/dev/null || true; fi\n"
        "fi\n"
        "echo \"[>] 3. Go CLI qua npm / pnpm / bun / nvm / pipx...\"\n"
        "for mgr in npm pnpm bun; do\n"
        "  if command -v \"$mgr\" >/dev/null 2>&1; then\n"
        "    [ \"$DRY_RUN\" -eq 1 ] && echo \"  [DRY-RUN] Se go $PKG_NAME qua $mgr\" || \"$mgr\" uninstall -g \"$PKG_NAME\" 2>/dev/null || true\n"
        "  fi\n"
        "done\n"
        "for nver in \"$HOME/.nvm/versions/node\"/*; do\n"
        "  [ -d \"$nver\" ] && rm_safe \"$nver/lib/node_modules/$PKG_NAME\"\n"
        "done\n"
        "echo \"[>] 4-6. Don thu muc cau hinh, cache, Keychain...\"\n"
        "for d in \"$HOME/.$TOOL_SLUG\" \"$HOME/.config/$TOOL_SLUG\" \"$HOME/.local/share/$TOOL_SLUG\" \"$HOME/.cache/$TOOL_SLUG\" \"$HOME/Library/Application Support/$TOOL_SLUG\" \"$HOME/Library/Caches/$TOOL_SLUG\"; do\n"
        "  rm_safe \"$d\"\n"
        "done\n"
        "echo \"[>] 7-9. Hoan tat kiem tra go bo $TOOL_SLUG.\"\n",
        sh_name,
    )

    bat_p, ps1_p, sh_p = out / bat_name, out / ps1_name, out / sh_name
    # Write CRLF strictly without BOM for .bat/.ps1 and LF without BOM for .sh
    bat_p.write_bytes(bat_src.encode("ascii"))
    ps1_p.write_bytes(ps1_src.encode("ascii"))
    sh_p.write_bytes(sh_src.encode("ascii"))
    try:
        sh_p.chmod(0o755)
    except OSError:
        pass
    return {"tool": slug, "bat": str(bat_p), "ps1": str(ps1_p), "sh": str(sh_p)}
