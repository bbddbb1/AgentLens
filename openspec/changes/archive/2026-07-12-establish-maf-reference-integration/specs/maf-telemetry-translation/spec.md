## ADDED Requirements

### Requirement: MAF translation remains private and framework-owned
MAF-specific keys, event names, native identity mapping, and request-response interpretation SHALL live in a private MAF translator or adapter module. The translator SHALL remain unversioned and unexported from public protocol packages.

#### Scenario: MAF telemetry is normalized
- **WHEN** adapter-produced MAF spans and events enter the API
- **THEN** the MAF translator converts supported native facts into the existing private normalized structure
- **AND** retains translation/source provenance

#### Scenario: Public exports are inspected
- **WHEN** implementation exports and packages are reviewed
- **THEN** no public MAF profile, RuntimeEvidence, RuntimeAdapter, or TelemetryProfile contract exists

### Requirement: Telemetry convention responsibilities remain separated
Generic OTel/GenAI interpretation, AgentLens compatibility behavior, LangGraph-specific translation, and MAF-specific translation SHALL remain separate. The generic projector SHALL consume normalized facts and SHALL NOT directly inspect MAF-specific keys or workflow-event names.

#### Scenario: Standard GenAI Agent or Tool telemetry is sufficient
- **WHEN** MAF emits supported standard GenAI attributes
- **THEN** generic OTel/GenAI normalization handles those standard facts
- **AND** the MAF translator does not create a competing interpretation

#### Scenario: MAF request event requires enrichment
- **WHEN** native OTLP does not durably preserve a streamed `request_info` fact
- **THEN** the MAF adapter emits narrow explicit enrichment and the MAF translator handles it

#### Scenario: Generic projection source is scanned
- **WHEN** `span_projection.v1` construction is inspected
- **THEN** it contains no direct MAF key/event interpretation

### Requirement: Translation uses one current production projection path
MAF normalized facts SHALL feed the existing `projectReplay()` and `projectTraceSnapshot()` path and existing explanation inputs. The change SHALL NOT add a second projector, projection selector, or public RuntimeEvidence bundle.

#### Scenario: MAF replay is requested
- **WHEN** the reference MAF telemetry is replayed
- **THEN** the response uses `span_projection.v1`
- **AND** matrix-backed workflow/executor/Agent/Tool/failure facts appear through the current compatible surfaces

#### Scenario: Runtime explanation is requested
- **WHEN** explanation is built for the MAF run
- **THEN** it consumes current derived replay/events
- **AND** does not reinterpret raw MAF telemetry independently

### Requirement: Translation remains evidence-first
The MAF translation path SHALL preserve explicit failure, SHALL create relationships only from explicit evidence, SHALL preserve unresolved targets without fabricated edges, SHALL avoid timing-only causality, and SHALL degrade unknown telemetry safely.

#### Scenario: Explicit executor failure and completion conflict
- **WHEN** telemetry contains explicit MAF failure plus weaker completion-like evidence
- **THEN** explicit failure remains the stronger preserved fact and a conflict diagnostic is retained where applicable

#### Scenario: Workflow steps overlap
- **WHEN** two executor activities overlap without explicit relationship evidence
- **THEN** normalization and projection create no causal edge from overlap

#### Scenario: Relationship target cannot be resolved
- **WHEN** explicit MAF relationship evidence names an unavailable target
- **THEN** the unresolved condition remains traceable
- **AND** no node or edge is fabricated

### Requirement: No dynamic framework machinery is introduced
The normalization implementation SHALL invoke the known LangGraph and MAF translators explicitly. Each explicit LangGraph or MAF governance route SHALL pass a small constant identity-policy object containing only expected framework, required keys, and consistency keys directly to the shared private matcher. The change SHALL NOT add dynamic profile selection, policy or adapter registration, a strategy framework, adapter factory, dynamic dispatch, plugin discovery, or a reusable/public policy or capability system.

#### Scenario: Translator selection is inspected
- **WHEN** the private normalization boundary is reviewed
- **THEN** MAF support is a direct private module integration
- **AND** no registry or plugin contract is required

#### Scenario: Identity policy selection is inspected
- **WHEN** the LangGraph and MAF route modules are reviewed
- **THEN** each route passes its small constant policy object directly to the shared private matcher
- **AND** no registry, strategy framework, adapter factory, dynamic dispatch, discovery mechanism, or public policy contract exists
