---
name: wiztree-cli-analyzer
description: Generates a batch wrapper to scan drives using WizTree CLI for finding large hidden files (MFT scan).
---

# WizTree CLI Scan Automation

This skill executes a fast, deep system scan using WizTree (if available on the machine) to export and parse the largest folders/files directly to the console. It bypasses slow PowerShell recursive checks and accesses the MFT (Master File Table) directly for instant results.

## When to Use
- When the user asks "why is my C drive full" or "find large hidden files".
- When standard cleanup scripts (`RUN_ALL_CLEANUP.bat`) fail to reclaim enough space.
- To detect massive OS files like `hiberfil.sys`, `pagefile.sys`, WSL/Docker `ext4.vhdx`, or forgotten ISOs.

## Execution Requirements
WizTree *must* be run with Administrator privileges (`/admin=1`) to access the MFT. Because the AI terminal is usually not elevated, you must provide the user with a `.bat` wrapper that elevates itself and triggers the scan.

## Standard `.bat` Wrapper Template
Provide this to the user to save and execute:

```bat
@echo off
echo ===================================================
echo WIZTREE DEEP SCAN ANALYZER
echo ===================================================
echo This will scan your C: and D: drives using WizTree
echo and find the absolute largest hidden folders.
echo.
echo Please accept the Administrator prompt.
echo.

net session >nul 2>&1
if %errorLevel% == 0 (
    goto :run_scan
) else (
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

:run_scan
::: Auto-discover WizTree64.exe via env WIZTREE_PATH, PATH, or standard install dirs
if not defined WIZTREE_PATH (
    for %%P in ("wiztree64.exe" "%ProgramFiles%\WizTree\WizTree64.exe" "%LOCALAPPDATA%\Programs\WizTree\WizTree64.exe") do (
        if exist %%P set WIZTREE_PATH=%%P
    )
)
if not defined WIZTREE_PATH (
    echo WizTree64.exe not found. Set WIZTREE_PATH or install WizTree.
    exit /b 1
)
echo Scanning C: Drive...
start /wait %WIZTREE_PATH% "C:\" /export="%~dp0wiztree_c.csv" /admin=1 /exportfolders=1 /exportfiles=0 /sortby=2 /exportmaxdepth=5

echo Scanning D: Drive...
start /wait %WIZTREE_PATH% "D:\" /export="%~dp0wiztree_d.csv" /admin=1 /exportfolders=1 /exportfiles=0 /sortby=2 /exportmaxdepth=5

echo.
echo Scan complete! Parsing results...
powershell -Command "Import-Csv '%~dp0wiztree_c.csv' | Select-Object -First 10 'File Name', 'Size', 'Allocated' | Format-Table -AutoSize"
powershell -Command "Import-Csv '%~dp0wiztree_d.csv' | Select-Object -First 10 'File Name', 'Size', 'Allocated' | Format-Table -AutoSize"

echo.
pause
```

## Common Large File Remediations
If the scan reveals these files, advise the user with the following actions:

1. **`hiberfil.sys`**:
   `powercfg -h off` (Disables hibernation, frees 6GB-16GB instantly).
2. **`ext4.vhdx`** (Docker/WSL2 data):
   `wsl --shutdown` then `Optimize-VHD -Path "<PathToVHDX>" -Mode Full` (Compacts virtual disk).
3. **`pagefile.sys`**:
   Advise moving virtual memory to another drive via `SystemPropertiesPerformance.exe`.
4. **`C:\Windows\Installer`**:
   Never delete manually. Recommend tools like PatchCleaner or `cleanmgr`.
5. **WinSxS**:
   `dism.exe /Online /Cleanup-Image /StartComponentCleanup`
