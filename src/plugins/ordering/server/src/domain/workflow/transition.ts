import type { WorkflowDefinition } from '../../contracts/workflow';
import { OrderingError } from '../errors';

/** Whether `from → to` is an allowed edge. Unknown `from` is not allowed. */
export function canTransition(definition: WorkflowDefinition, from: string, to: string): boolean {
  return definition.states[from]?.next.includes(to) ?? false;
}

/** Guards a transition; throws `INVALID_TRANSITION` with the workflow and both states. */
export function assertTransition(
  definition: WorkflowDefinition,
  from: string,
  to: string,
): void {
  if (!canTransition(definition, from, to)) {
    throw new OrderingError(
      'INVALID_TRANSITION',
      `workflow ${definition.name}@${definition.version} cannot move "${from}" → "${to}"`,
      { details: { workflow: `${definition.name}@${definition.version}`, from, to } },
    );
  }
}

/** Terminal kind of a state, or null for non-terminal/unknown states. */
export function isTerminal(
  definition: WorkflowDefinition,
  state: string,
): 'success' | 'canceled' | null {
  return definition.states[state]?.terminal ?? null;
}

/** Customer-facing states only; unknown states are not public. */
export function isPublicState(definition: WorkflowDefinition, state: string): boolean {
  return definition.states[state]?.isPublic ?? false;
}
