from __future__ import annotations

import json

from agntz.client.models import EvalDataset, EvalDefinition, EvalRun
from agntz.evals import (
    build_judge_prompt,
    cancel_eval_run,
    create_eval_judge_agent,
    judge_output_schema,
    parse_judge_output_text,
)
from agntz.stores import MemoryStore


def test_eval_judge_agent_schema_and_prompt_match_ts_shape() -> None:
    definition = EvalDefinition.model_validate(
        {
            "id": "eval_1",
            "agentId": "support",
            "name": "Quality",
            "passThreshold": 0.75,
            "judgeModel": {"provider": "openai", "name": "custom-judge"},
            "criteria": [
                {
                    "id": "accuracy",
                    "name": "Accuracy",
                    "description": "Correct answer.",
                    "threshold": 0.8,
                }
            ],
        }
    )
    dataset = EvalDataset.model_validate(
        {
            "id": "dataset_1",
            "agentId": "support",
            "name": "Cases",
            "metadata": {"suite": "smoke"},
            "items": [
                {
                    "id": "case_1",
                    "name": "Greeting",
                    "input": "hello",
                    "metadata": {"source": "unit"},
                }
            ],
        }
    )

    schema = judge_output_schema(definition.criteria)
    assert schema["required"] == ["overallScore", "passed", "criteria", "reason"]
    assert schema["properties"]["criteria"]["required"] == ["accuracy"]

    judge = create_eval_judge_agent("judge_1", definition)
    assert judge.model.name == "custom-judge"
    assert judge.output_schema == schema

    prompt = json.loads(
        build_judge_prompt(
            definition,
            dataset,
            dataset.items[0],
            {"answer": "hi"},
        )
    )
    assert prompt == {
        "input": "hello",
        "actual": '{"answer":"hi"}',
        "itemMetadata": {"source": "unit"},
        "datasetMetadata": {"suite": "smoke"},
        "criteria": [
            {
                "id": "accuracy",
                "name": "Accuracy",
                "description": "Correct answer.",
                "threshold": 0.8,
            }
        ],
        "passThreshold": 0.75,
    }


def test_parse_judge_output_text_accepts_fenced_json() -> None:
    assert parse_judge_output_text('```json\n{"overallScore": 1}\n```') == {
        "overallScore": 1
    }


def test_cancel_eval_run_marks_pending_cases_and_latest_score() -> None:
    store = MemoryStore()
    definition = EvalDefinition.model_validate(
        {
            "id": "eval_1",
            "agentId": "support",
            "name": "Quality",
            "criteria": [{"id": "accuracy", "name": "Accuracy"}],
        }
    )
    dataset = EvalDataset.model_validate(
        {
            "id": "dataset_1",
            "agentId": "support",
            "name": "Cases",
            "items": [{"id": "case_1", "name": "Greeting", "input": "hello"}],
        }
    )
    run = EvalRun.model_validate(
        {
            "id": "evalrun_1",
            "evalId": definition.id,
            "datasetId": dataset.id,
            "agentId": "support",
            "status": "running",
            "startedAt": "2026-06-05T12:00:00.000Z",
            "snapshots": {
                "eval": definition.model_dump(by_alias=True, exclude_none=True),
                "dataset": dataset.model_dump(by_alias=True, exclude_none=True),
                "agent": {"id": "support", "name": "Support"},
            },
            "caseResults": [],
        }
    )
    store.put_eval_run(run)

    cancelled = cancel_eval_run(store, run)
    latest = store.get_eval_latest_score(
        eval_id=definition.id,
        dataset_id=dataset.id,
        resolved_agent_version=None,
    )

    assert cancelled.status == "cancelled"
    assert cancelled.case_results[0].status == "cancelled"
    assert cancelled.summary is not None
    assert cancelled.summary.skipped_cases == 1
    assert latest is not None
    assert latest.status == "cancelled"
