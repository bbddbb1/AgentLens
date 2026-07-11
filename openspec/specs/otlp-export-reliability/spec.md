## Purpose

Define reliable HTTP success and failure semantics for AgentLens OTLP export and ingest.

## Requirements

### Requirement: Python OTLP exporter accepts every HTTP 2xx response
The AgentLens Python OTLP exporter SHALL classify any HTTP response with status code from `200` through `299` as a successful export.

#### Scenario: Server returns HTTP 200
- **WHEN** the exporter receives HTTP `200` for a non-empty span batch
- **THEN** it returns `SpanExportResult.SUCCESS`

#### Scenario: Server returns HTTP 202
- **WHEN** the exporter receives HTTP `202` for a non-empty span batch
- **THEN** it returns `SpanExportResult.SUCCESS`

### Requirement: Python OTLP exporter preserves failure classification
The AgentLens Python OTLP exporter SHALL classify non-`2xx` HTTP responses and request/transport exceptions as failed exports.

#### Scenario: Server returns representative 4xx
- **WHEN** the exporter receives HTTP `400`
- **THEN** it returns `SpanExportResult.FAILURE`

#### Scenario: Server returns representative 5xx
- **WHEN** the exporter receives HTTP `500`
- **THEN** it returns `SpanExportResult.FAILURE`

#### Scenario: Request raises an exception or timeout
- **WHEN** the HTTP client raises a request exception or timeout supported by the exporter test structure
- **THEN** the exporter returns `SpanExportResult.FAILURE`

### Requirement: Valid ingest response contracts remain unchanged
AgentLens ingest routes SHALL retain their valid HTTP success response contract and SHALL NOT be changed solely to accommodate an exporter that previously recognized only HTTP `200`.

#### Scenario: Compatibility ingest succeeds
- **WHEN** `/api/v1/ingest/otlp` validates and durably ingests a span batch
- **THEN** the route returns HTTP `202` with its compatibility response body

#### Scenario: Standard OTLP JSON ingest succeeds
- **WHEN** `/v1/traces` validates and durably ingests a span batch
- **THEN** the route returns HTTP `202` with zero rejected spans

#### Scenario: Ingest validation fails
- **WHEN** either ingest route receives invalid input
- **THEN** it returns a `4xx` response that the exporter classifies as failure
