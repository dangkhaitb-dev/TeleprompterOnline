import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const isCi = /^(1|true)$/i.test(process.env.CI ?? '');

// Cloudflare Pages and source archives do not need repository hooks. Keep the
// prepare lifecycle safe when there is no .git directory in the build image.
if (isCi || !existsSync('.git')) process.exit(0);

const command = process.platform === 'win32' ? 'lefthook.cmd' : 'lefthook';
execFileSync(command, ['install'], { stdio: 'inherit' });
