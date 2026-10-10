import { describe, expect, it } from 'vitest';

import type { WorkflowDefinition } from '../../contracts/workflow';
import { isOrderingError } from '../errors';
import { assertWorkflowDefinition, validateWorkflowDefinition } from './definition';
import { builtinWorkflows } from './definitions';

const base = (overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  name: 'test',
  version: '1',
  initial: 'a',
  cancelState: 'dead',
  states: {
    a: { next: ['b', 'dead'], isPublic: true },
    b: { next: ['c'], isPublic: true },
    c: { next: [], terminal: 'success', isPublic: true },
    dead: { next: [], terminal: 'canceled', isPublic: true },
  },
  ...overrides,
});

describe('validateWorkflowDefinition', () => {
  it('accepts the three builtin definitions', () => {
    for (const definition of builtinWorkflows) {
      expect(validateWorkflowDefinition(definition)).toEqual([]);
    }
  });

  it('flags a missing initial state', () => {
    const problems = validateWorkflowDefinition(base({ initial: 'ghost' }));
    expect(problems.join('; ')).toContain('initial "ghost" is not a state');
  });

  it('flags a dangling next target', () => {
    const def = base();
    def.states.a.next = ['nowhere'];
    const problems = validateWorkflowDefinition(def);
    expect(problems.join('; ')).toContain('unknown next state "nowhere"');
  });

  it('flags a terminal state with outgoing edges', () => {
    const def = base();
    def.states.c.next = ['a'];
    const problems = validateWorkflowDefinition(def);
    expect(problems.join('; ')).toContain('terminal state "c" must not have next states');
  });

  it('flags an invalid terminal value', () => {
    const def = base();
    def.states.c = { next: [], terminal: 'nope' as 'success', isPublic: true };
    const problems = validateWorkflowDefinition(def);
    expect(problems.join('; ')).toContain('invalid terminal');
  });

  it('flags an unreachable state', () => {
    const def = base();
    def.states.lonely = { next: ['c'], isPublic: true };
    const problems = validateWorkflowDefinition(def);
    expect(problems.join('; ')).toContain('state "lonely" is unreachable from initial');
  });

  it('flags a non-terminal state that can never end', () => {
    const def = base();
    def.states.a.next = ['loop-b', 'dead'];
    def.states['loop-b'] = { next: ['loop-c'], isPublic: true };
    def.states['loop-c'] = { next: ['loop-b'], isPublic: true };
    const problems = validateWorkflowDefinition(def);
    expect(problems.join('; ')).toContain('can never reach a terminal state');
  });

  it('flags a cancelState that is not canceled-terminal', () => {
    const problems = validateWorkflowDefinition(base({ cancelState: 'c' }));
    expect(problems.join('; ')).toContain('cancelState "c" must be a canceled-terminal state');
  });

  it('flags a self loop', () => {
    const def = base();
    def.states.a.next = ['a'];
    const problems = validateWorkflowDefinition(def);
    expect(problems.join('; ')).toContain('must not transition to itself');
  });

  it('flags a workflow with no terminal state', () => {
    const def = base();
    delete def.states.c;
    delete def.states.dead;
    def.states.a.next = ['b'];
    def.states.b.next = [];
    const problems = validateWorkflowDefinition(def);
    expect(problems.join('; ')).toContain('workflow has no terminal state');
  });
});

describe('assertWorkflowDefinition', () => {
  it('throws WORKFLOW_INVALID listing the problems', () => {
    try {
      assertWorkflowDefinition(base({ initial: 'ghost' }));
      expect.unreachable();
    } catch (error) {
      expect(isOrderingError(error)).toBe(true);
      expect((error as { code: string }).code).toBe('WORKFLOW_INVALID');
      expect((error as Error).message).toContain('workflow test@1:');
      expect((error as Error).message).toContain('initial "ghost" is not a state');
    }
  });

  it('passes valid definitions', () => {
    for (const definition of builtinWorkflows) {
      expect(() => assertWorkflowDefinition(definition)).not.toThrow();
    }
  });
});
