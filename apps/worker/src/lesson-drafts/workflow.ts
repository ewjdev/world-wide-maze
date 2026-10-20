/**
 * The `LESSON_DRAFT` Workflow: one instance per operator message (`<draft id>-t<turn>`). The steps live in
 * pipeline.ts; this class supplies the model provider from the Worker's config and reports back to the draft's
 * `LessonDraftAgent`. An unhandled error (a failed model call, a missing provider) reaches the agent's
 * `onWorkflowError`, which marks the turn failed.
 */
import type { WorkflowStepConfig } from 'cloudflare:workers';
import { AgentWorkflow, type AgentWorkflowEvent, type AgentWorkflowStep } from 'agents/workflows';
import type { LessonDraftAgent } from './agent.ts';
import { createDraftModel, type LessonDraftVars, lessonDraftSettings } from './config.ts';
import { type DraftOutcome, type DraftParams, runDraftPipeline, type StepRunner } from './pipeline.ts';

export class LessonDraftWorkflow extends AgentWorkflow<LessonDraftAgent, DraftParams> {
  override async run(event: AgentWorkflowEvent<DraftParams>, step: AgentWorkflowStep): Promise<DraftOutcome> {
    const env = this.env as Env & LessonDraftVars;
    const settings = lessonDraftSettings(env);
    const model = createDraftModel(env, settings);
    if (!settings.enabled || !model) throw new Error('lesson drafts are off or have no model provider');
    const runner: StepRunner = {
      do: (name, config, callback) =>
        step.do(name, config as WorkflowStepConfig, callback as () => Promise<never>) as Promise<never>,
    };
    // The payload also carries the Agents SDK's own routing fields; the pipeline reads only its own.
    const { draftId, turn, objective, brief, message, count, base, dropped, avoid } = event.payload;
    return runDraftPipeline(
      runner,
      {
        draftId,
        turn,
        objective,
        brief,
        message,
        count,
        base: [...base],
        dropped: [...dropped],
        avoid: [...(avoid ?? [])],
      },
      {
        model,
        maxTokens: settings.maxTokens,
        save: (revision) => this.agent.recordRevision(revision),
        ready: (doneTurn, hash, summary) => this.agent.turnReady(doneTurn, hash, summary),
      },
    );
  }
}
