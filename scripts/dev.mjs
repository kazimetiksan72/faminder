import { spawn } from 'node:child_process';
const children = ['@faminder/api', '@faminder/admin'].map((workspace) =>
  spawn('npm', ['run', 'dev', '-w', workspace], { stdio: 'inherit' }),
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
for (const child of children) child.on('exit', (code) => stop(code ?? 0));
