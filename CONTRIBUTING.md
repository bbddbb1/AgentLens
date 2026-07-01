# Contributing to AgentLens

Thank you for your interest in contributing. AgentLens is a framework-agnostic control plane for multi-agent AI systems, and we welcome improvements across the entire stack — from the TypeScript API and Python SDKs to the Next.js review UI and documentation.

## Code of Conduct

This project adheres to a standard open-source code of conduct. By participating, you are expected to uphold these guidelines. Please report unacceptable behavior to the project maintainers.

## Contribution Workflow

We follow a standard **Fork → Branch → Pull Request** model:

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/agentlens.git
   cd agentlens
   ```
3. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
   Use a descriptive branch name prefixed with the change type: `feat/`, `fix/`, `docs/`, `refactor/`, `chore/`.
4. **Make your changes.** Write code, add tests, and ensure existing tests pass.
5. **Push** to your fork:
   ```bash
   git push -u origin feat/my-feature
   ```
6. **Open a Pull Request** against the `main` branch. Fill out the PR template with a clear description, motivation, and test plan.

### Before Opening a PR

- [ ] Changes are focused — one logical change per PR.
- [ ] Tests pass locally (`pnpm test` for TypeScript, `uv run pytest` for Python).
- [ ] Linting passes (`pnpm lint`, `uv run ruff check`).
- [ ] No new warnings or errors in the build.
- [ ] Documentation is updated if public APIs or configuration surfaces change.

### Design constraints

Changes to protocol, replay, governance, or branch semantics must respect AgentLens core rules. Before merging, verify:

- Raw recorded telemetry remains the source of truth; projections disclose evidence gaps
  instead of inferring hidden intent or domain meaning.
- The L0 raw evidence, L1 universal deterministic projection, and L2 optional lens
  boundaries remain one-way; L2 cannot alter core runtime facts.
- Canonical history is append-only; corrections are new events.
- Replay must be deterministic from canonical events (gaps → explicit markers).
- Branches are isolated histories with lineage, not UI filters.
- Semantic conventions (`EventEnvelope`, `semconv`) are the compatibility boundary.
- Governance decisions (policy, HITL) are ledger events, not side channels.
- Existing evidence and runtime concepts are reused before proposing new schemas, node
  kinds, or replay semantics.
- Runtime-affecting behavior is specified first and validated with a domain-specific
  workload plus at least one generic/non-domain fixture.

The [AgentLens Constitution](.specify/memory/constitution.md) is authoritative. See
[docs/explanation/architecture.md#design-constraints](docs/explanation/architecture.md#design-constraints)
for the detailed architecture rules and review checklist.

## Coding Standards

AgentLens enforces consistent style through automated tooling. Please do not bypass or disable these checks.

### TypeScript (API Server, Web UI, Protocol)

- **Formatter**: [Prettier](https://prettier.io/) — run `pnpm format` before committing.
- **Linter**: [ESLint 9](https://eslint.org/) with `eslint-config-next` (web) and TypeScript rules. Run `pnpm lint`.
- **Type Checking**: TypeScript strict mode. Run `pnpm build` which includes `tsc --noEmit` checks.
- **Validation**: All API inputs are validated with [Zod](https://zod.dev/) schemas. New routes must include Zod-based request validation.
- **Testing**: [Vitest](https://vitest.dev/). Tests are co-located in `tests/` directories and named `*.test.ts`.

### Python (SDKs, Graph Engine, Semantic Conventions)

- **Formatter & Linter**: [Ruff](https://docs.astral.sh/ruff/) — configured in `pyproject.toml` with rules `E`, `F`, `I`, `N`, `W`, `UP`. Run `uv run ruff check`.
- **Line Length**: 100 characters (configured in `pyproject.toml`).
- **Python Version**: 3.11+ (`pyproject.toml` specifies `requires-python = ">=3.11"`).
- **Type Hints**: Use `from __future__ import annotations` and standard type hints throughout.
- **Testing**: [pytest](https://docs.pytest.org/) with `asyncio_mode = "auto"`. Run `uv run pytest`.
- **Package Layout**: Follow the existing pattern — each package lives under `packages/<name>/` with the source in a flat-layout module.

### General Guidelines

- Follow existing patterns in the codebase. When in doubt, find a similar file and mirror its structure.
- Keep functions small and focused. Avoid premature abstraction.
- Do not introduce new dependencies without a clear justification.
- Environment variables must be documented in `.env.example`.

## Commit Messages

This repository **strictly enforces** the [Conventional Commits](https://www.conventionalcommits.org/) specification. Every commit message must follow this format:

```
<type>(<scope>): <short description>

<optional body>

<optional footer>
```

### Common Type Prefixes

| Type | Use Case |
|---|---|
| `feat:` | A new feature (triggers a minor version bump) |
| `fix:` | A bug fix (triggers a patch version bump) |
| `docs:` | Documentation changes only |
| `refactor:` | Code restructuring without behavior change |
| `perf:` | Performance improvement |
| `test:` | Adding or updating tests |
| `chore:` | Build process, tooling, or dependency updates |
| `ci:` | CI/CD configuration changes |
| `style:` | Formatting, whitespace (no code change) |

### Scope (Optional but Recommended)

Use the workspace or package name: `api-ts`, `web`, `protocol`, `sdk-core`, `sdk-langgraph`, `otel-semconv`, `graph-engine`, `docs`, `examples`.

### Examples

**Good:**

```
feat(api-ts): add idempotency-key support to interrupt decision endpoint
```

```
fix(sdk-core): handle null span attributes in OTLP exporter serialization
```

```
docs: bootstrap open-source docs, coding standards, and agent architecture spec
```

```
refactor(protocol): extract agent span kind constants into shared semconv module
```

```
chore: upgrade turbo to v2.3 and pnpm to v9.15
```

**Bad:**

```
updated stuff
```

```
fixed bug
```

```
WIP
```

Commits that do not follow the Conventional Commits format will be asked to be amended during code review.

## Getting Help

- **Bug Reports**: Open an issue using the bug report template.
- **Feature Requests**: Open an issue with the `enhancement` label. Describe the problem you're trying to solve before proposing a solution.
- **Questions**: Start a GitHub Discussion.

Thank you for contributing to AgentLens.
