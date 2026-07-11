## MODIFIED Requirements

### Requirement: Internal facts preserve recorded native identity and correlation
The private structure SHALL preserve framework identity, thread/run/parent-run identity, interrupt request identity, checkpoint reference where observable, activity correlation, trace/span correlation, and an optional AgentLens-derived `native_execution_key` when those values are explicitly recorded. When lifecycle evidence for the same activity carries identity fields on different events, AgentLens SHALL merge identity field by field, SHALL retain earlier explicit values when later evidence omits them, and SHALL detect conflicting explicit values rather than silently overwrite them. Observational identity SHALL NOT by itself authorize governance delivery. Governance identity matching for actionability SHALL use the deterministic required and consistency field rules defined by the LangGraph governance delivery and interaction capabilities; `native_execution_key` SHALL NOT be used as a match or authentication credential.

#### Scenario: LangGraph run metadata is observable
- **WHEN** adapter telemetry records run and thread identity
- **THEN** normalized facts retain those identifiers and source references without inferring missing values

#### Scenario: Later lifecycle evidence is partial
- **WHEN** an earlier lifecycle event records thread, run, checkpoint, and activity-correlation identifiers and a later event for the same activity records only an interrupt identifier
- **THEN** the merged native identity retains every non-conflicting explicitly recorded field
- **AND** no earlier value is removed because it was absent from the later event

#### Scenario: Explicit native identifiers conflict
- **WHEN** lifecycle evidence for one activity records different explicit values for the same native identity field
- **THEN** normalization emits a traceable native-identity conflict diagnostic containing the conflicting source references
- **AND** governance delivery that depends on the ambiguous identity is not actionable

#### Scenario: Checkpoint reference is observable
- **WHEN** callback metadata explicitly records a checkpoint identifier or namespace
- **THEN** normalized facts preserve the reference
- **AND** exclude checkpoint payload/state

#### Scenario: Native identifier is unavailable
- **WHEN** a native identity field is not observable in source telemetry
- **THEN** the field remains unavailable and the capability matrix records the limitation

#### Scenario: Observational identity is presented for governance
- **WHEN** an interaction request carries `native_runtime_identity` or `native_execution_key`
- **THEN** those values remain provenance and correlation only
- **AND** the bridge requires its separate private adapter-owned control reference before delivery
- **AND** matching for actionability does not treat `native_execution_key` as an authentication or binding credential
