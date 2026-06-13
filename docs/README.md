# AgentLens Documentation

AgentLens documentation is organized using the [Diátaxis framework](https://diataxis.fr/) across tutorials, how-to guides, architecture explanations, and reference specifications.

## Start Here

| What do you need? | Category | Description |
|---|---|---|
| **I want to get started** | **Tutorials** | Step-by-step guides for setting up the project and running demos. Start with [Getting Started](tutorials/getting-started.md). |
| **I want to achieve a specific goal** | **How-To Guides** | Problem-oriented guides. (e.g., instrumenting agents) |
| **I want to understand the design** | **Explanation** | Background, [Architecture](explanation/architecture.md), [Design Notes](explanation/design-notes.md), and [Product Vision](explanation/background.md). |
| **I want to look up facts** | **Reference** | Technical specs. See [Agent API](reference/agent-api.md) and [Semantic Conventions](reference/semconv.md). |

## Project & Community

- **[Roadmap](project/roadmap.md)**: Prioritized engineering milestones and future plans.

## Contributing Guidelines

When modifying AgentLens behavior:
1. Update [semconv.md](reference/semconv.md) and `packages/protocol` if attributes or events change.
2. Update [agent-api.md](reference/agent-api.md) if the current implementation changes.
3. Update [architecture.md](explanation/architecture.md) only when a core rule is added or changed deliberately.
4. Add or adjust milestones in [roadmap.md](project/roadmap.md) — do not bury new work in prose elsewhere.
