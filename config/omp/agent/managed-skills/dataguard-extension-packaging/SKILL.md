---
name: dataguard-extension-packaging
description: "Build, verify, and stage DataGuard VS Code and Visual Studio VSIX artifacts with SHA-256 checksums."
---

# DataGuard extension packaging

Run from the repository root unless stated otherwise. This creates local installation artifacts only; it does not publish to marketplaces.

## VS Code

```powershell
Set-Location src\DataGuard.VSCode
npm test
npm run package
```

`npm run package` runs `prepare-lsp`, which copies the Release language server into `server/` and creates its integrity manifest before creating the VSIX.
If the default `node` on `PATH` is Node 18 (where `@vscode/vsce` fails on `util.styleText` or `require("parse5")`), run:

```powershell
npm run prepare-lsp
bun ./node_modules/@vscode/vsce/vsce package
```

Stage the package:

```powershell
Set-Location ..\..
$version = (Get-Content src\DataGuard.VSCode\package.json -Raw | ConvertFrom-Json).version
$source = "src\DataGuard.VSCode\dataguard-vscode-$version.vsix"
$destination = "artifacts\vscode\dataguard-vscode-$version.vsix"
New-Item -ItemType Directory -Force artifacts\vscode | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Force
$hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$destination.sha256" -Value "$hash  $(Split-Path -Leaf $destination)" -NoNewline
```

## Visual Studio

Use Visual Studio's MSBuild located with `vswhere`; do not substitute `dotnet build` for this release-style VSIX packaging path.
Ensure `src\DataGuard.VisualStudio\BindingRedirects.cs` (`10.0.0.N`) matches the `System.Text.Json` `PackageReference` version (`10.0.N`) in `src\DataGuard.VisualStudio\DataGuard.VisualStudio.csproj`, or `CreatePkgDef.exe` will reject `NewVersion`.

```powershell
$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
$msbuild = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -find "MSBuild\**\Bin\MSBuild.exe" | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($msbuild)) { throw "MSBuild.exe was not found by vswhere." }
& $msbuild src\DataGuard.VisualStudio\DataGuard.VisualStudio.csproj /t:Rebuild /p:CreateVsixContainer=true /p:Configuration=Release /restore
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

Verify the packaged VSIX and run `DataGuard.VisualStudio.Tests` with `DATAGUARD_VSIX_EXPECTED=1` (pass `-p:BuildProjectReferences=false` so `dotnet test` does not rebuild `DataGuard.VisualStudio.csproj` with `CreateVsixContainer=false` and wipe the VSIX):

```powershell
$version = (Get-Content src\DataGuard.VSCode\package.json -Raw | ConvertFrom-Json).version
& .\scripts\assert-vsix.ps1 -VsixPath "src\DataGuard.VisualStudio\bin\Release\net472\DataGuard.VisualStudio.vsix" -ExpectedVersion $version
$env:DATAGUARD_VSIX_EXPECTED = "1"
dotnet test tests/DataGuard.VisualStudio.Tests/DataGuard.VisualStudio.Tests.csproj --configuration Release --no-restore -p:BuildProjectReferences=false
```

Stage the package:

```powershell
$version = (Get-Content src\DataGuard.VSCode\package.json -Raw | ConvertFrom-Json).version
$source = "src\DataGuard.VisualStudio\bin\Release\net472\DataGuard.VisualStudio.vsix"
$destination = "artifacts\visualstudio\dataguard-visualstudio-$version.vsix"
New-Item -ItemType Directory -Force artifacts\visualstudio | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Force
$hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$destination.sha256" -Value "$hash  $(Split-Path -Leaf $destination)" -NoNewline
```

## Reference

The repository maintains the user-facing bilingual guides:
- `docs/05-operations/extension-build-guide.vi.md`
- `docs/05-operations/extension-build-guide.md`
