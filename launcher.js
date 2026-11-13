import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const URL = 'http://127.0.0.1:4173';
const noOpen = process.argv.includes('--no-open');

async function isRunning() {
  try {
    const response = await fetch(`${URL}/api/health`, {
      signal: AbortSignal.timeout(800),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function openBrowser() {
  if (noOpen) return;
  try {
    spawn('cmd.exe', ['/c', 'start', '', URL], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  } catch {
    // 浏览器打开失败时，用户仍可手动访问地址
  }
}

async function main() {
  if (await isRunning()) {
    console.log(`页间已经在运行：${URL}`);
    openBrowser();
    return;
  }

  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, PORT: '4173' },
  });
  child.unref();

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (await isRunning()) {
      console.log(`页间已启动：${URL}`);
      openBrowser();
      return;
    }
  }

  console.error('服务没有在预期时间内启动。请在项目目录运行：node server/index.js');
  process.exitCode = 1;
}

main();
