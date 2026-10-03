---
name: dataguard-vs-extension-patterns
description: "DataGuard Visual Studio extension development patterns: thread-safe progress accumulation, VS SDK navigation, MSBuild VSIX bundling without ProjectReference."
---

# DataGuard VS Extension — Key Patterns

## Thread-safe background event accumulation
`TryFormatProgress` is `static`; instance accumulation uses an `out` tuple param + caller aggregates into a locked list.

```csharp
// Field
private readonly List<(string? RuleId, string? RuleTitle, int ViolationCount)> _ruleInventory = new();

// ALL three sites MUST lock:
lock (this._ruleInventory) { this._ruleInventory.Add(entry); }   // background stderr reader
lock (this._ruleInventory) { this._ruleInventory.Clear(); }       // RunValidationAsync (UI thread)
lock (this._ruleInventory) { banner = BuildBanner(this._ruleInventory); }  // Summary event
```

## VS SDK navigation (correct pattern)
`VsShellUtilities.OpenDocumentAndNavigateToPosition` does NOT exist. Use:
```csharp
VsShellUtilities.OpenDocument(this, path, VSConstants.LOGVIEWID_Code,
    out _, out _, out IVsWindowFrame frame, out IVsTextView view);
frame?.Show();
view?.SetCaretPos(line, col);   // 0-based (SARIF is 1-based: subtract 1)
view?.CenterLines(line, 1);
```
Requires `using Microsoft.VisualStudio.TextManager.Interop;`.
Reference existing usage: `DataGuardLogger.cs:385`.

## VSIX Roslyn analyzer bundling (zero ProjectReference)
Never add `<ProjectReference>` to `DataGuard.VisualStudio.csproj`. Use MSBuild Exec pattern:
```xml
<Target Name="BuildAnalyzers" Condition="'$(CreateVsixContainer)' == 'true'" BeforeTargets="IncludeAnalyzersInVsix">
  <Exec Command="dotnet build &quot;...DataGuard.Analyzers.csproj&quot; -c $(Configuration) -o &quot;$(DataGuardAnalyzersPublishDir)&quot; --no-restore" />
</Target>
<Target Name="IncludeAnalyzersInVsix" ...>
  <VSIXSourceItem Include="$(DataGuardAnalyzersPublishDir)DataGuard.Analyzers.dll" />
</Target>
```
vsixmanifest: `d:Source="File"` not `d:Source="Project"`.

## net472 test projects
For `ZipFile`/`ZipArchive` in net472 test projects:
```xml
<Reference Include="System.IO.Compression" />
<Reference Include="System.IO.Compression.FileSystem" />
<Reference Include="System.Xml.Linq" />
```
NuGet packages do NOT cover these for net472.

## Correct method names (verified)
- `ExtractContractsAsync` at `ProjectCSharpSqlSource.cs:82` (NOT `ExtractContractsFromCompilationAsync`)
- `IsSqlString` at line 945 (private static — expose as internal for testability or use reflection)
- Test dir: `tests/` not `test/`

## SP prefix set (IsSqlString)
`sp_`, `usp_`, `PROC_`, `FNC_`, `P_` + dot-notation Oracle packages (`PKG.PROC`).
