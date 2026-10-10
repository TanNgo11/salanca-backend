import type { WorkflowDefinition } from '../../contracts/workflow';

/**
 * Minimal shape check used at registration until the full graph validator lands (Step 6:
 * `next` targets exist, terminals have no outgoing edges, exactly the declared terminals).
 */
export function assertWorkflowShape(definition: WorkflowDefinition): void {
  const label = `"${definition.name}@${definition.version}"`;
  if (!definition.states[definition.initial]) {
    throw new Error(`[ordering] workflow ${label} initial "${definition.initial}" is not a state`);
  }
  const cancelState = definition.states[definition.cancelState];
  if (!cancelState || cancelState.terminal !== 'canceled') {
    throw new Error(
      `[ordering] workflow ${label} cancelState "${definition.cancelState}" must be a canceled-terminal state`,
    );
  }
}
