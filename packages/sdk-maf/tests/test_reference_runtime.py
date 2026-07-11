import asyncio

import pytest

from agentlens_maf.reference_runtime import (
    create_reference_agent,
    create_reference_review_workflow,
    create_reference_tool,
    create_reference_workflow,
    ReferenceReviewResponse,
)


def test_real_maf_agent_runs_without_external_credentials() -> None:
    response = asyncio.run(create_reference_agent().run("review this"))

    assert response.messages[-1].contents[0].text == "Reference review is ready."


def test_real_maf_function_tool_is_explicitly_invoked() -> None:
    tool = create_reference_tool()

    result = asyncio.run(tool.invoke(arguments={"value": "  review me  "}, skip_parsing=True))

    assert result == "reviewed:review me"


def test_real_maf_workflow_runs_agent_tool_and_executor() -> None:
    result = asyncio.run(create_reference_workflow().run("review me"))

    assert result.get_outputs() == ["Reference review is ready. reviewed:review me"]


def test_real_maf_workflow_reports_explicit_executor_failure() -> None:
    with pytest.raises(RuntimeError, match="reference executor failure"):
        asyncio.run(create_reference_workflow().run("fail"))


def test_native_request_info_can_continue_with_a_typed_response() -> None:
    async def exercise() -> tuple[object, object]:
        workflow = create_reference_review_workflow()
        pending = await workflow.run("release candidate")
        request = pending.get_request_info_events()[0]
        continued = await workflow.run(
            responses={request.request_id: ReferenceReviewResponse(approved=True, note="approved")}
        )
        return request, continued

    request, continued = asyncio.run(exercise())

    assert request.request_id == "agentlens-reference-review-request"
    assert request.source_executor_id == "agentlens-reference-review-executor"
    assert request.response_type is ReferenceReviewResponse

    assert continued.get_outputs() == ["continued:release candidate:approved"]


def test_native_request_info_can_take_the_truthful_alternative_path() -> None:
    async def exercise() -> object:
        workflow = create_reference_review_workflow()
        pending = await workflow.run("release candidate")
        request = pending.get_request_info_events()[0]
        return await workflow.run(
            responses={request.request_id: ReferenceReviewResponse(approved=False, note="rejected")}
        )

    alternative = asyncio.run(exercise())
    assert alternative.get_outputs() == ["alternative:release candidate:rejected"]


def test_native_response_validation_rejects_an_unsupported_response_shape() -> None:
    async def exercise() -> None:
        workflow = create_reference_review_workflow()
        pending = await workflow.run("release candidate")
        request = pending.get_request_info_events()[0]
        await workflow.run(responses={request.request_id: "approved"})

    with pytest.raises((TypeError, ValueError), match="ReferenceReviewResponse|response"):
        asyncio.run(exercise())
