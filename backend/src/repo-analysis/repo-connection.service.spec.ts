import { describe, expect, it, vi } from 'vitest';
import { fetchGitHubRepoInfo, parseGitHubUrl } from './repo-connection.service.js';

describe('parseGitHubUrl', () => {
  it('parses plain, trailing-slash, .git-suffixed and http URLs', () => {
    expect(parseGitHubUrl('https://github.com/bazelbuild/examples')).toEqual({
      owner: 'bazelbuild',
      repo: 'examples',
    });
    expect(parseGitHubUrl('https://github.com/bazelbuild/examples/')).toEqual({
      owner: 'bazelbuild',
      repo: 'examples',
    });
    expect(parseGitHubUrl('https://github.com/bazelbuild/examples.git')).toEqual({
      owner: 'bazelbuild',
      repo: 'examples',
    });
    expect(parseGitHubUrl('http://github.com/owner-1/repo.name')).toEqual({
      owner: 'owner-1',
      repo: 'repo.name',
    });
  });

  it('rejects non-GitHub URLs and malformed input', () => {
    for (const bad of [
      '',
      'not a url',
      'https://gitlab.com/owner/repo',
      'https://github.com/owner',
      'ftp://github.com/owner/repo',
      'https://github.com/owner/repo/extra/path',
      'javascript:alert(1)',
    ]) {
      expect(parseGitHubUrl(bad)).toBeNull();
    }
  });
});

describe('fetchGitHubRepoInfo', () => {
  const okFetch = (defaultBranch = 'main') =>
    vi.fn(async () => new Response(JSON.stringify({ default_branch: defaultBranch }), { status: 200 }));

  it('returns the default branch on success', async () => {
    const info = await fetchGitHubRepoInfo('owner', 'repo', 'tok', okFetch('trunk'));
    expect(info.defaultBranch).toBe('trunk');
  });

  it('rejects an invalid/expired token with a 401', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    await expect(fetchGitHubRepoInfo('owner', 'repo', 'tok', fetchImpl)).rejects.toThrow(/rejected this token/);
  });

  it('rejects a missing repo or unreadable repo with a 404', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }));
    await expect(fetchGitHubRepoInfo('owner', 'repo', 'tok', fetchImpl)).rejects.toThrow(/not found/);
  });

  it('surfaces a network failure as a clear error, not a raw exception', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(fetchGitHubRepoInfo('owner', 'repo', 'tok', fetchImpl)).rejects.toThrow(/Could not reach GitHub/);
  });

  it('rejects a 200 response missing a default_branch', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    await expect(fetchGitHubRepoInfo('owner', 'repo', 'tok', fetchImpl)).rejects.toThrow(/default branch/);
  });
});
