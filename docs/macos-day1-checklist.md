# macOS Day-1 Setup & Verification Checklist

Quickstart runbook to set up and verify a complete, identical Oh-My-Pi (`omp`) and Claude Code environment on a new macOS machine (Apple Silicon M1/M2/M3/M4 or Intel).

---

## 1. Prerequisites (Homebrew)

Open Terminal and run:

```bash
# Install Homebrew if not already installed:
# /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install GnuPG, Apple Silicon pinentry, Bun, and uv:
brew install gnupg pinentry-mac bun uv python3

# Optional: if you need to process legacy binary .mpp files without converting to .xml first:
brew install mpxj
```

---

## 2. Clone Repository & Stage 1 Public Restore

```bash
git clone https://github.com/thanhnt-sm/zuey-pi-setup.git ~/zuey-pi-setup
cd ~/zuey-pi-setup

# Stage 1: Public restore (creates ~/.omp, installs native tools, links skills, updates plugins)
./scripts/omp-bootstrap.sh --mode restore --link-mirrors --link-claude
```

---

## 3. Stage 2 Private Restore (Optional GPG Archive)

If you exported a private GPG archive from your primary machine (`~/omp-private-backups/omp-private-*.tar.gz.gpg`):

```bash
# Ensure omp is stopped before restoring private state:
killall omp 2>/dev/null || true

# Restore mnemopi memory banks, prompt history, and ClaudeKit:
./scripts/omp-bootstrap.sh --mode restore \
  --private-archive ~/Downloads/omp-private-<timestamp>.tar.gz.gpg \
  --link-mirrors --link-claude
```

*(Note: On Apple Silicon, GPG pinentry uses GUI `pinentry-mac` automatically; loopback mode is used as an automatic fallback if terminal pinentry is active.)*

---

## 4. Run Strict Healthcheck & Verification

```bash
# 1. Run cross-OS strict doctor:
python3 scripts/omp-doctor.py --strict --json

# 2. Run extension integration tests:
bun test tests/test-omp-toolkit-hub.test.ts

# 3. Verify Python domain suites:
python3 -m unittest discover -s config/omp/agent/skills -p "test_*.py"
```

Expected output: `{"ok": true, "status": "HEALTHY", "warnings": [], "errors": []}`.

---

## 5. Daily Usage & Auto-Sync (Optional)

```bash
# Run non-destructive drift check anytime:
./scripts/omp-bootstrap.sh --mode doctor

# Install optional daily launchd background harvest & drift notification:
./scripts/omp-schedule-sync.sh --install --interval-hours 24
```
