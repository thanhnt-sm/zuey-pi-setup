#Requires -Version 5.1
<#
.SYNOPSIS
Windows wrapper for scripts/omp-bootstrap.sh that enforces Git Bash (never WSL System32\bash.exe).
#>
[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ForwardArgs
)

$ErrorActionPreference = 'Stop'

function Resolve-GitBash {
  $candidates = @(
    $env:GIT_BASH_BIN,
    'C:\Program Files\Git\bin\bash.exe',
    'C:\Program Files (x86)\Git\bin\bash.exe'
  ) | Where-Object { $_ -and (Test-Path $_) }

  foreach ($cand in $candidates) {
    if ($cand -notmatch '(?i)\\System32\\bash\.exe$' -and $cand -notmatch '(?i)WindowsApps') {
      return $cand
    }
  }

  $cmd = Get-Command bash.exe -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -notmatch '(?i)\\System32\\bash\.exe$' -and $cmd.Source -notmatch '(?i)WindowsApps') {
    return $cmd.Source
  }
  throw "Git Bash not found (refusing WSL C:\Windows\System32\bash.exe). Install Git for Windows or set GIT_BASH_BIN."
}

$gitBash = Resolve-GitBash
$scriptSh = Join-Path $PSScriptRoot 'omp-bootstrap.sh'
$shUnix = $scriptSh -replace '\\', '/'
if ($shUnix -match '^([A-Za-z]):/(.*)$') {
  $shUnix = '/' + $Matches[1].ToLower() + '/' + $Matches[2]
}

$quotedArgs = @($shUnix) + ($ForwardArgs | ForEach-Object { $_ })
& $gitBash $quotedArgs
exit $LASTEXITCODE
