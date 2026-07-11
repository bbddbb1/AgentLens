## ADDED Requirements

### Requirement: Integrity APIs distinguish unsupported verification from valid and invalid
Until AgentLens persists the hashes required for cryptographic verification and actually performs that verification, audit-event and mission-integrity APIs SHALL report verification as unsupported or not verified. They SHALL NOT report the mission, branch, or event stream as cryptographically valid or cryptographically invalid.

#### Scenario: Audit events are returned without hash verification support
- **WHEN** audit events are requested for a mission and branch under the current span-backed persistence model
- **THEN** the response identifies verification as unsupported/not verified
- **AND** validity is represented as unevaluated rather than `true` or `false`

#### Scenario: Empty audit stream is returned
- **WHEN** no projected audit events exist for the requested mission and branch
- **THEN** the response still identifies verification as unsupported/not verified
- **AND** it does not claim vacuous cryptographic validity

#### Scenario: Mission verification endpoint is called
- **WHEN** the integrity verification endpoint is called before hash-chain support exists
- **THEN** the mission and branch reports identify verification as unsupported/not verified with an explanatory reason

### Requirement: Shared integrity contracts represent an unevaluated state
AgentLens shared protocol types SHALL represent at least verified-valid, verified-invalid, and unsupported/not-verified states without coercing unsupported verification to either boolean outcome.

#### Scenario: Unsupported report crosses API boundary
- **WHEN** an unsupported integrity report is serialized and consumed by the Web client
- **THEN** the shared contract preserves its unevaluated validity and explicit verification status

### Requirement: Audit UI presents integrity truthfully
The AgentLens Web Audit surface SHALL present unsupported/not-verified integrity as a neutral unavailable state and SHALL reserve secure/compromised claims for actual verification results.

#### Scenario: Current unsupported report is displayed
- **WHEN** the Web client receives the current unsupported/not-verified integrity response
- **THEN** it displays a neutral `NOT VERIFIED` or `UNSUPPORTED` message
- **AND** it does not display `SECURE`, `COMPROMISED`, "cryptographically proven," or an assertion that tampering was detected

#### Scenario: Audit data has not loaded
- **WHEN** no integrity result is available yet
- **THEN** the Web client does not synthesize a valid hash-chain fallback

### Requirement: Baseline does not implement cryptographic integrity
This change SHALL NOT add hash-chain generation, signing, a durable `EventEnvelope` ledger, or new integrity persistence.

#### Scenario: Baseline implementation is reviewed
- **WHEN** the completed implementation is inspected
- **THEN** integrity work is limited to truthful contracts, responses, presentation, and tests
- **AND** no new hash/signature persistence or verification algorithm is present
