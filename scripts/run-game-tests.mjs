import { mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const outputDirectory = resolve('node_modules/.cache/bate-bate-tests');
const outputFile = resolve(outputDirectory, 'game-systems.test.mjs');

await mkdir(outputDirectory, { recursive: true });
try {
  await build({ entryPoints: ['tests/game-systems.test.ts'], outfile: outputFile, bundle: true, packages: 'external', platform: 'node', format: 'esm' });
  const result = spawnSync(process.execPath, ['--test', outputFile], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}
