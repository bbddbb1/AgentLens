"""Small deterministic MAF runtime used as the integration's native reference."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from agent_framework import (
    Agent,
    BaseChatClient,
    ChatResponse,
    Executor,
    FunctionTool,
    Message,
    WorkflowBuilder,
    WorkflowContext,
    handler,
    response_handler,
)


class DeterministicModelClient(BaseChatClient[dict[str, Any]]):
    """Credential-free MAF model client that always returns a stable response."""

    OTEL_PROVIDER_NAME = "agentlens.reference"

    async def _inner_get_response(
        self,
        *,
        messages: Sequence[Message],
        stream: bool,
        options: Mapping[str, Any],
        **_: Any,
    ) -> ChatResponse:
        if stream:
            raise ValueError("The deterministic reference client only supports non-streaming responses")
        await self._validate_options(options)
        return ChatResponse(
            messages=[Message(role="assistant", contents=["Reference review is ready."])],
            response_id="reference-model-response",
            model="agentlens-deterministic-model",
        )


def classify_reference_input(value: str) -> str:
    """A real MAF FunctionTool target with stable, inspectable behavior."""
    return f"reviewed:{value.strip()}"


def create_reference_tool() -> FunctionTool:
    return FunctionTool(
        name="classify_reference_input",
        description="Classifies the reference input deterministically.",
        func=classify_reference_input,
    )


def create_reference_agent() -> Agent:
    """Create a native MAF Agent wired to the deterministic model and tool."""
    return DeterministicModelClient().as_agent(
        id="agentlens-reference-agent",
        name="AgentLens Reference Agent",
        instructions="Return the deterministic reference review.",
        tools=[create_reference_tool()],
    )


class ReferenceExecutionExecutor(Executor):
    """Runs the real reference Agent and Tool inside a native MAF executor."""

    def __init__(self) -> None:
        super().__init__(id="agentlens-reference-executor")

    @handler
    async def process(self, value: str, ctx: WorkflowContext[None, str]) -> None:
        if value == "fail":
            raise RuntimeError("reference executor failure")

        agent_response = await create_reference_agent().run(value)
        tool_result = await create_reference_tool().invoke(
            arguments={"value": value}, skip_parsing=True
        )
        await ctx.yield_output(f"{agent_response.messages[-1].contents[0].text} {tool_result}")


def create_reference_workflow():
    """Build the stable MAF workflow used by reference fixtures and tests."""
    executor = ReferenceExecutionExecutor()
    return WorkflowBuilder(
        start_executor=executor,
        name="agentlens-maf-reference-workflow",
        output_from=[executor],
    ).build()


@dataclass(frozen=True)
class ReferenceReviewRequest:
    """Typed native payload for the reference `request_info` event."""

    subject: str


@dataclass(frozen=True)
class ReferenceReviewResponse:
    approved: bool
    note: str = ""
    # Private bridge-to-native correlation. It is never rendered as response content.
    delivery_id: str = ""
    post_acceptance_failure: bool = False


class ReferenceReviewExecutor(Executor):
    def __init__(self, request_id: str = "agentlens-reference-review-request") -> None:
        super().__init__(id="agentlens-reference-review-executor")
        self.request_id = request_id

    @handler
    async def request_review(self, value: str, ctx: WorkflowContext[None, str]) -> None:
        request = ReferenceReviewRequest(subject=value)
        await ctx.request_info(
            request,
            ReferenceReviewResponse,
            request_id=self.request_id,
        )
        from .enrichment import emit_enrichment, request_attributes
        emit_enrichment("agentlens.maf.request_info", request_attributes(self.request_id, request))

    @response_handler
    async def handle_review_response(
        self,
        original_request: ReferenceReviewRequest,
        response: ReferenceReviewResponse,
        ctx: WorkflowContext[None, str],
    ) -> None:
        outcome = "continued" if response.approved else "alternative"
        from .enrichment import emit_enrichment, terminal_attributes
        if response.post_acceptance_failure:
            try:
                # Exercise a native execution failure after MAF accepts the
                # typed response, then report the correlated runtime result.
                raise RuntimeError("reference post-acceptance processing failed")
            except RuntimeError:
                emit_enrichment(
                    "agentlens.maf.response_accepted",
                    terminal_attributes(
                        self.request_id,
                        response,
                        terminal_outcome="failed",
                    ),
                )
                await ctx.yield_output(f"failed:{original_request.subject}")
                return
        emit_enrichment(
            "agentlens.maf.response_accepted",
            terminal_attributes(self.request_id, response),
        )
        await ctx.yield_output(f"{outcome}:{original_request.subject}:{response.note}")


def create_reference_review_workflow(request_id: str = "agentlens-reference-review-request"):
    """Build the native request/response workflow with truthful alternative handling."""
    executor = ReferenceReviewExecutor(request_id)
    return WorkflowBuilder(
        start_executor=executor,
        name="agentlens-maf-reference-review-workflow",
        output_from=[executor],
    ).build()
