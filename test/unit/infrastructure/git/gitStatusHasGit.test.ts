import './submissionTestHarness';
import { afterEach, describe, expect, it } from 'vitest';
import { harness, uri } from './submissionTestHarness';
import { GitStatusService } from '../../../../src/infrastructure/git/gitStatusService.js';

describe('GitStatusService hasGit', () => {
  afterEach(() => {
    harness.gitApiState = undefined;
  });

  it('confirms a missing repository once Git has finished discovery', async () => {
    harness.repository = undefined;
    harness.gitApiState = 'initialized';
    const result = await new GitStatusService().getStatuses(uri('file:///plain') as never, []);
    expect(result.hasGit).toBe(false);
    expect(result.submission).toBeUndefined();
  });

  it('does not conclude that a folder lacks Git while discovery is still running', async () => {
    harness.repository = undefined;
    harness.gitApiState = 'uninitialized';
    const result = await new GitStatusService().getStatuses(uri('file:///plain') as never, []);
    expect(result.hasGit).toBeUndefined();
  });
});
