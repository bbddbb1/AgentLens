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


class ReferenceReviewExecutor(Executor):
    def __init__(self) -> None:
        super().__init__(id="agentlens-reference-review-executor")

    @handler
    async def request_review(self, value: str, ctx: WorkflowContext[None, str]) -> None:
        await ctx.request_info(
            ReferenceReviewRequest(subject=value),
            ReferenceReviewResponse,
            request_id="agentlens-reference-review-request",
        )

    @response_handler
    async def handle_review_response(
        self,
        original_request: ReferenceReviewRequest,
        response: ReferenceReviewResponse,
        ctx: WorkflowContext[None, str],
    ) -> None:
        outcome = "continued" if response.approved else "alternative"
        await ctx.yield_output(f"{outcome}:{original_request.subject}:{response.note}")


def create_reference_review_workflow():
    """Build the native request/response workflow with truthful alternative handling."""
    executor = ReferenceReviewExecutor()
    return WorkflowBuilder(
        start_executor=executor,
        name="agentlens-maf-reference-review-workflow",
        output_from=[executor],
    ).build()
