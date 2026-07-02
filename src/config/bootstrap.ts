import { mkdirSync, copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Env } from './env.js';

/**
 * Ensure persistent XDG directories exist and materialize the OpenCode
 * configuration file from OPENCODE_CONFIG_CONTENT (or copy the default).
 */
export function bootstrap(env: Env): void {
  for (const dir of [env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_CACHE_HOME, env.REPOS_DIR]) {
    mkdirSync(dir, { recursive: true });
  }

  const opencodeConfigDir = join(env.XDG_CONFIG_HOME, '.opencode');
  mkdirSync(opencodeConfigDir, { recursive: true });
  const opencodeConfigPath = join(opencodeConfigDir, 'opencode.json');

  if (env.OPENCODE_CONFIG_CONTENT) {
    writeFileSync(opencodeConfigPath, env.OPENCODE_CONFIG_CONTENT);
    console.log('Wrote OpenCode config from OPENCODE_CONFIG_CONTENT');
  } else if (!existsSync(opencodeConfigPath) && existsSync('/app/opencode.json')) {
    copyFileSync('/app/opencode.json', opencodeConfigPath);
    console.log('Copied default OpenCode config');
  }
}
