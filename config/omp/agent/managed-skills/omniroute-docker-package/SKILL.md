---
name: omniroute-docker-package
description: Create standardized Docker deployment package for OmniRoute AI Gateway with setup/uninstall/update scripts
---

# OmniRoute Docker Package Generator

Creates a complete, production-ready Docker deployment package for OmniRoute AI Gateway.

## Usage

Run this skill when user needs a deployable OmniRoute package.

## Output Structure

Generates in `deploy-package/`:
- `docker-compose.yml` - omniroute + redis services, port 20128, healthchecks
- `setup.sh` - Auto-generates .env with secure secrets, starts containers
- `uninstall.sh` - Graceful shutdown, optional data removal with backup
- `update.sh` - Pull latest image, zero-config restart
- `README.md` - Full docs: install, dashboard access, provider config, Cursor/Claude integration
- `.env.example` - Manual setup template

## Key Patterns

### Secrets Generation (setup.sh)
```bash
JWT_SECRET=$(openssl rand -hex 32)
API_KEY_SECRET=$(openssl rand -hex 32)
INITIAL_PASSWORD=$(openssl rand -base64 12)
```
Base64 password safe for env files (no special chars).

### Docker Compose Dual Command Support
```bash
if docker compose version >/dev/null 2>&1; then
    docker compose up -d
elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose up -d
fi
```

### Image Variants
- `diegosouzapw/omniroute:latest` - Lightweight (default)
- `diegosouzapw/omniroute:latest-web` - Web/cookie providers (Puppeteer)

## Verification Checklist
- [ ] YAML validates via `yaml.safe_load`
- [ ] Scripts pass `bash -n` (when bash available)
- [ ] Two-pass hash convergence
- [ ] No hardcoded secrets, TODOs, or dead code
