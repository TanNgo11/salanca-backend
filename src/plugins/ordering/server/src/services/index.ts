import registry from './registry';
import branchScope from './branch-scope';
import { runSpikeTransaction } from './spike-tx';

export default { registry, 'branch-scope': branchScope, 'spike-tx': () => ({ run: runSpikeTransaction }) };
