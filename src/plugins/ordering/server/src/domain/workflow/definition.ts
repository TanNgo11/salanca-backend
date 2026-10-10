import type { WorkflowDefinition } from '../../contracts/workflow';
import { OrderingError } from '../errors';

/**
 * Graph validation for a workflow definition. Returns human-readable problems; an empty list
 * means the definition is safe to register. Runs at registration so bad graphs never reach
 * runtime transitions.
 */
export function validateWorkflowDefinition(definition: WorkflowDefinition): string[] {
  const problems: string[] = [];
  if (!definition.name) problems.push('name must not be empty');
  if (!definition.version) problems.push('version must not be empty');
  const states = definition.states ?? {};
  const names = Object.keys(states);
  if (names.length === 0) problems.push('workflow must declare at least one state');

  if (!states[definition.initial]) {
    problems.push(`initial "${definition.initial}" is not a state`);
  }
  const cancel = states[definition.cancelState];
  if (!cancel) {
    problems.push(`cancelState "${definition.cancelState}" is not a state`);
  } else if (cancel.terminal !== 'canceled') {
    problems.push(`cancelState "${definition.cancelState}" must be a canceled-terminal state`);
  }

  for (const [name, state] of Object.entries(states)) {
    if (state.terminal !== undefined) {
      if (state.terminal !== 'success' && state.terminal !== 'canceled') {
        problems.push(`state "${name}" has invalid terminal "${String(state.terminal)}"`);
      }
      if (state.next.length > 0) {
        problems.push(`terminal state "${name}" must not have next states`);
      }
    }
    for (const target of state.next) {
      if (target === name) {
        problems.push(`state "${name}" must not transition to itself`);
      } else if (!states[target]) {
        problems.push(`state "${name}" references unknown next state "${target}"`);
      }
    }
  }

  const terminalNames = names.filter((name) => states[name].terminal !== undefined);
  if (names.length > 0 && terminalNames.length === 0) {
    problems.push('workflow has no terminal state');
  }

  // Reachability from initial.
  if (states[definition.initial]) {
    const reachable = new Set<string>([definition.initial]);
    const queue = [definition.initial];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const target of states[current].next) {
        if (states[target] && !reachable.has(target)) {
          reachable.add(target);
          queue.push(target);
        }
      }
    }
    for (const name of names) {
      if (!reachable.has(name)) problems.push(`state "${name}" is unreachable from initial`);
    }
  }

  // Every non-terminal state must be able to reach a terminal (reverse walk from terminals).
  const canEnd = new Set<string>(terminalNames);
  const predecessors = new Map<string, string[]>();
  for (const [name, state] of Object.entries(states)) {
    for (const target of state.next) {
      if (states[target]) {
        const list = predecessors.get(target) ?? [];
        list.push(name);
        predecessors.set(target, list);
      }
    }
  }
  const queue = [...terminalNames];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const predecessor of predecessors.get(current) ?? []) {
      if (!canEnd.has(predecessor)) {
        canEnd.add(predecessor);
        queue.push(predecessor);
      }
    }
  }
  for (const name of names) {
    if (!canEnd.has(name)) {
      problems.push(`state "${name}" can never reach a terminal state`);
    }
  }

  return problems;
}

/** Throws `OrderingError('WORKFLOW_INVALID')` listing every problem found. */
export function assertWorkflowDefinition(definition: WorkflowDefinition): void {
  const problems = validateWorkflowDefinition(definition);
  if (problems.length > 0) {
    throw new OrderingError(
      'WORKFLOW_INVALID',
      `workflow ${definition.name}@${definition.version}: ${problems.join('; ')}`,
    );
  }
}
