# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

AgentLens takes security seriously. If you discover a security vulnerability, please do **not** open a public GitHub issue.

Instead, report it via:

- **Email**: Send details to the project maintainers. We will acknowledge within 48 hours and provide a timeline for resolution.
- **GitHub Security Advisories**: Use the "Report a vulnerability" button on the [Security tab](https://github.com/agentlens/agentlens/security/advisories).

### What to Include

- Description of the vulnerability
- Steps to reproduce (proof-of-concept code if applicable)
- Affected versions
- Any known mitigations

### Process

1. You submit a report via one of the channels above.
2. Maintainers acknowledge receipt within 48 hours.
3. Maintainers investigate and determine impact.
4. A fix is developed and tested privately.
5. A security advisory is published alongside the patch release.
6. You will be credited in the advisory (unless you prefer to remain anonymous).

## Security Best Practices for AgentLens Deployments

- **Never commit `.env` files.** The `.gitignore` excludes them, but verify before committing.
- **Rotate `API_SECRET_KEY`** from the default `change-me-in-production` value before any production deployment.
- **Use strong Postgres and MinIO passwords** — the defaults in `docker-compose.yml` are for local development only.
- **Run behind a reverse proxy** (nginx, Caddy) with TLS termination in production.
- **Restrict CORS origins** (`API_CORS_ORIGINS`) to your actual frontend domain.
- **Limit MinIO bucket access** — the default bucket initialization script sets `download` access for convenience; lock this down for production.
- **LLM API keys** (OpenAI, Anthropic, Ollama) should be scoped and rotated regularly.

## Dependency Scanning

This project uses Dependabot/GitHub-native dependency scanning. Keep dependencies updated — particularly `next`, `react`, `express`, and any packages handling authentication or cryptography.
