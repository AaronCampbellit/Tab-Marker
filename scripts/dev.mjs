// Rebuild the unpacked extension on source changes; reload it at chrome://extensions.
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
let running = false;
let pending = false;
function build() {
  if (running) { pending = true; return; }
  running = true;
  const task = spawn('npm', ['run', 'build'], { stdio: 'inherit', shell: false });
  task.on('exit', () => { running = false; if (pending) { pending = false; build(); } });
}
for (const path of ['src', 'public']) watch(path, { recursive: true }, () => build());
for (const path of ['popup.html', 'options.html']) watch(path, () => build());
build();
