// Runs the API server (with --watch) and the Vite dev server together.
import { spawn } from 'node:child_process';

// shell: true lets Windows find npm.cmd; a single command string avoids
// Node's warning about passing separate args alongside shell: true.
const run = (script) => spawn(`npm run ${script}`, { stdio: 'inherit', shell: true });

const procs = [run('dev:server'), run('dev:client')];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { stop(); process.exit(code ?? 0); });
