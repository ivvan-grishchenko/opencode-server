import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { Logger } from 'pino';
import { simpleGit, ResetMode, CheckRepoActions, type SimpleGit } from 'simple-git';

import type { Env, RepoConfig } from '../config/env.js';

/**
 * Verify the GitHub token is present. simple-git authenticates via an
 * `http.extraheader` config flag (never written to `.git/config`), so no
 * `gh` CLI or credential helper is required.
 */
export function ensureGitHubToken(env: Env): void {
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required to clone repositories');
}

function createGit(env: Env, baseDir: string): SimpleGit {
  const auth = `Authorization: Basic ${Buffer.from(`x-access-token:${env.GITHUB_TOKEN}`).toString('base64')}`;
  return simpleGit({
    baseDir,
    config: [`http.https://github.com/.extraheader=${auth}`],
  });
}

export async function syncRepo(repo: RepoConfig, env: Env, log: Logger): Promise<void> {
  const repoPath = join(env.REPOS_DIR, repo.name);
  mkdirSync(repoPath, { recursive: true });

  const remoteUrl = `https://github.com/${repo.owner}/${repo.repo}.git`;
  const branch = repo.branch;
  const fullName = `${repo.owner}/${repo.repo}`;

  const repoGit = createGit(env, repoPath);
  const isRepo = await repoGit.checkIsRepo(CheckRepoActions.IS_REPO_ROOT).catch(() => false);

  if (isRepo) {
    log.info({ repo: repo.name, fullName, branch }, 'Updating existing repo');
    await repoGit.fetch('origin', branch);
    await repoGit.reset(ResetMode.HARD, [`origin/${branch}`]);
    return;
  }

  log.info({ repo: repo.name, fullName, branch, repoPath }, 'Cloning repo');
  await createGit(env, env.REPOS_DIR).clone(remoteUrl, repoPath, {
    '--depth': 1,
    '--branch': branch,
  });
}

export async function syncAllRepos(repos: RepoConfig[], env: Env, log: Logger): Promise<void> {
  log.info({ count: repos.length }, 'Synchronizing configured repositories');
  await Promise.all(repos.map((repo) => syncRepo(repo, env, log.child({ repo: repo.name }))));
}
