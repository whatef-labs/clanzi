// clanzi 설치·제거·상태 확인.
//   node scripts/install.mjs [install|uninstall|status] [--yes] [--dry-run] [--link]
// install   : 빌드 → Studio 플러그인 설치(복사, --link면 개발용 정션) → 설정 백업 → Claude Code mod 설치
// uninstall : 설정 백업 → mod와 마켓플레이스 제거(설정 항목 포함) → Studio 플러그인 제거
// 여러 번 실행해도 이미 된 단계는 건너뛴다. ~/.claude/settings.json을 바꾸기 전에는 계획을 보여 주고 확인을 받는다.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = 'com.ulanzi.clanzi.ulanziPlugin';
const SOURCE = join(ROOT, PACKAGE);
const STUDIO_DIR = join(process.env.APPDATA ?? '', 'Ulanzi', 'UlanziDeck');
const TARGET = join(STUDIO_DIR, 'Plugins', PACKAGE);
const MARKETPLACE = 'clanzi-local';
const MARKETPLACE_DIR = join(ROOT, 'claude-plugin');
const PLUGIN_ID = `clanzi@${MARKETPLACE}`;
const SETTINGS = join(homedir(), '.claude', 'settings.json');
const MIN_CLAUDE = [2, 1, 287];
/** Studio 플러그인으로 복사하는 것. 실행 중 생기는 state/, logs/는 건드리지 않는다. */
const PACKAGE_FILES = ['manifest.json', 'package.json', 'en.json', 'ko_KR.json', 'resources', 'scripts', 'plugin'];

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith('--')) ?? 'install';
const yes = args.includes('--yes');
const dryRun = args.includes('--dry-run');
const link = args.includes('--link');
/** claudeCommand가 한 번 찾은 claude 실행 파일 경로(못 찾으면 null) */
let claudePath;

try {
  if (command === 'install') await install();
  else if (command === 'uninstall') await uninstall();
  else if (command === 'status') await status();
  else fail(`알 수 없는 명령: ${command} (install | uninstall | status)`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

async function install() {
  checkPlatform();
  checkClaude();
  const studio = studioState();
  const mod = modState();
  const steps = [];
  steps.push('빌드: plugin/app.js');
  if (studio.kind === 'junction' && studio.toSource) steps.push(`Studio 플러그인: 개발용 정션 유지 (${TARGET})`);
  else if (link) steps.push(`Studio 플러그인: 개발용 정션 연결 ${TARGET} -> ${SOURCE}`);
  else steps.push(`Studio 플러그인: ${studio.kind === 'missing' ? '복사' : '다시 복사'} -> ${TARGET}`);
  const settingsSteps = [];
  if (!mod.marketplace) settingsSteps.push(`마켓플레이스 추가: ${MARKETPLACE} (${MARKETPLACE_DIR}) → settings.json의 extraKnownMarketplaces`);
  else if (resolve(mod.marketplace.path) !== resolve(MARKETPLACE_DIR)) fail(`이미 다른 경로의 ${MARKETPLACE} 마켓플레이스가 있습니다: ${mod.marketplace.path}. 먼저 uninstall 하세요.`);
  if (!mod.plugin) settingsSteps.push(`mod 설치: ${PLUGIN_ID} (user 범위) → settings.json의 enabledPlugins`);
  else if (mod.plugin.version !== mod.folderVersion) steps.push(`mod 갱신: ${mod.plugin.version} → ${mod.folderVersion}`);
  else steps.push(`mod: ${PLUGIN_ID} ${mod.plugin.version} 이미 설치됨`);

  printPlan(steps, settingsSteps);
  if (dryRun) return;
  if (settingsSteps.length > 0 && !(await confirm('~/.claude/settings.json이 위와 같이 바뀝니다. 진행할까요?'))) fail('취소했습니다.');

  run(process.execPath, [join(ROOT, 'scripts', 'build.mjs')], '빌드');
  installStudioPlugin(studio);
  if (settingsSteps.length > 0) backupSettings();
  if (!mod.marketplace) run('claude', ['plugin', 'marketplace', 'add', MARKETPLACE_DIR], '마켓플레이스 추가');
  if (!mod.plugin) run('claude', ['plugin', 'install', PLUGIN_ID, '--scope', 'user'], 'mod 설치');
  else if (mod.plugin.version !== mod.folderVersion) run('claude', ['plugin', 'update', PLUGIN_ID], 'mod 갱신');

  console.log(`
완료. 다음을 해 주세요.
  1. Ulanzi Studio를 재시작합니다. 실행 중인 플러그인은 재시작해야 새 파일을 읽습니다.
  2. 이미 열린 Claude Code 세션에서 /reload-plugins 를 실행합니다. 새 세션은 바로 적용됩니다.
  3. Studio에서 Clanzi의 '세션 슬롯', '사용량', '세션 페이지'(노브) 액션을 키에 놓습니다.`);
}

async function uninstall() {
  checkPlatform();
  const studio = studioState();
  const mod = modState();
  const steps = [];
  const settingsSteps = [];
  if (mod.marketplace) settingsSteps.push(`마켓플레이스 제거: ${MARKETPLACE} (mod ${PLUGIN_ID}와 settings.json의 해당 항목도 함께 제거)`);
  else if (mod.plugin) settingsSteps.push(`mod 제거: ${PLUGIN_ID}`);
  if (studio.kind === 'junction') steps.push(`Studio 플러그인: 개발용 정션 제거 (원본 폴더는 그대로) ${TARGET}`);
  else if (studio.kind === 'folder') steps.push(`Studio 플러그인 폴더 삭제: ${TARGET}`);
  if (steps.length + settingsSteps.length === 0) {
    console.log('설치된 것이 없습니다.');
    return;
  }
  printPlan(steps, settingsSteps);
  if (dryRun) return;
  if (!(await confirm('위 항목을 제거할까요?'))) fail('취소했습니다.');

  if (settingsSteps.length > 0) backupSettings();
  if (mod.marketplace) run('claude', ['plugin', 'marketplace', 'remove', MARKETPLACE], '마켓플레이스 제거');
  else if (mod.plugin) run('claude', ['plugin', 'uninstall', PLUGIN_ID], 'mod 제거');
  if (studio.kind === 'junction') rmSync(TARGET);
  else if (studio.kind === 'folder') rmSync(TARGET, { recursive: true, force: true });
  console.log(`
완료. Ulanzi Studio를 재시작하면 Clanzi가 목록에서 사라집니다.
열린 Claude Code 세션은 /reload-plugins 하거나 다시 시작하면 mod가 빠집니다.`);
}

async function status() {
  const studio = studioState();
  const mod = modState();
  const studioText = { missing: '설치 안 됨', folder: '설치됨(복사)', junction: studio.toSource ? '설치됨(개발용 정션)' : `정션이 다른 곳을 가리킴: ${studio.linkTarget}` }[studio.kind];
  console.log(`Studio 플러그인 : ${studioText}  ${TARGET}`);
  console.log(`마켓플레이스     : ${mod.marketplace ? `${MARKETPLACE} (${mod.marketplace.path})` : '없음'}`);
  console.log(`Claude Code mod : ${mod.plugin ? `${PLUGIN_ID} ${mod.plugin.version}${mod.plugin.enabled ? '' : ' (꺼짐)'}` : '설치 안 됨'}  (폴더 버전 ${mod.folderVersion})`);
  try {
    const res = await fetch('http://127.0.0.1:39311/health', { signal: AbortSignal.timeout(1000) });
    console.log(`브리지          : ${res.ok ? '응답함 (Studio 플러그인 실행 중)' : `응답 ${res.status}`}`);
  } catch {
    console.log('브리지          : 응답 없음 (Studio가 꺼져 있거나 플러그인이 실행 중이 아님)');
  }
}

function installStudioPlugin(studio) {
  if (studio.kind === 'junction' && studio.toSource) return;
  if (studio.kind === 'junction') rmSync(TARGET);
  mkdirSync(dirname(TARGET), { recursive: true });
  if (link) {
    if (studio.kind === 'folder') rmSync(TARGET, { recursive: true, force: true });
    symlinkSync(SOURCE, TARGET, 'junction');
    console.log(`Studio 플러그인 정션 연결: ${TARGET}`);
    return;
  }
  mkdirSync(TARGET, { recursive: true });
  for (const name of PACKAGE_FILES) {
    const from = join(SOURCE, name);
    if (!existsSync(from)) fail(`${from}이 없습니다. 빌드가 실패했는지 확인하세요.`);
    rmSync(join(TARGET, name), { recursive: true, force: true });
    if (lstatSync(from).isDirectory()) cpSync(from, join(TARGET, name), { recursive: true });
    else copyFileSync(from, join(TARGET, name));
  }
  console.log(`Studio 플러그인 복사: ${TARGET}`);
}

function studioState() {
  const stat = lstatSync(TARGET, { throwIfNoEntry: false });
  if (!stat) return { kind: 'missing' };
  if (stat.isSymbolicLink()) {
    const linkTarget = readlinkSync(TARGET);
    return { kind: 'junction', linkTarget, toSource: resolve(linkTarget) === resolve(SOURCE) };
  }
  return { kind: 'folder' };
}

function modState() {
  const plugins = claudeJson(['plugin', 'list', '--json']);
  const marketplaces = claudeJson(['plugin', 'marketplace', 'list', '--json']);
  const folderVersion = JSON.parse(readFileSync(join(MARKETPLACE_DIR, 'clanzi', '.claude-plugin', 'plugin.json'), 'utf8')).version;
  return {
    plugin: plugins.find((p) => p.id === PLUGIN_ID),
    marketplace: marketplaces.find((m) => m.name === MARKETPLACE),
    folderVersion,
  };
}

function claudeJson(cmdArgs) {
  return JSON.parse(execFileSync(...claudeCommand(cmdArgs), { encoding: 'utf8' }));
}

/** PATH에서 claude를 찾아 [실행 파일, 인자]로 돌려준다. npm으로 설치해 .cmd인 경우 cmd.exe로 감싼다. */
function claudeCommand(cmdArgs) {
  if (claudePath === undefined) {
    try {
      claudePath = execFileSync('where.exe', ['claude'], { encoding: 'utf8' }).split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? null;
    } catch {
      claudePath = null;
    }
  }
  if (!claudePath) fail('claude 명령을 찾지 못했습니다. Claude Code를 설치하고 PATH에 있는지 확인하세요.');
  if (/\.(cmd|bat)$/i.test(claudePath)) return ['cmd.exe', ['/d', '/s', '/c', claudePath, ...cmdArgs]];
  return [claudePath, cmdArgs];
}

function checkPlatform() {
  if (process.platform !== 'win32') fail('Windows 전용입니다.');
  if (!existsSync(STUDIO_DIR)) fail(`Ulanzi Studio 데이터 폴더가 없습니다: ${STUDIO_DIR}`);
}

function checkClaude() {
  const version = execFileSync(...claudeCommand(['--version']), { encoding: 'utf8' }).match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);
  if (!version) fail('Claude Code 버전을 읽지 못했습니다.');
  for (let i = 0; i < 3; i++) {
    if (version[i] > MIN_CLAUDE[i]) break;
    if (version[i] < MIN_CLAUDE[i]) fail(`Claude Code ${MIN_CLAUDE.join('.')} 이상이 필요합니다(mods). 지금: ${version.join('.')}`);
  }
}

function backupSettings() {
  if (!existsSync(SETTINGS)) return;
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const backup = `${SETTINGS}.clanzi-bak-${stamp}`;
  copyFileSync(SETTINGS, backup);
  console.log(`설정 백업: ${backup}`);
}

function run(cmd, cmdArgs, label) {
  console.log(`\n▶ ${label}`);
  const [file, fileArgs] = cmd === 'claude' ? claudeCommand(cmdArgs) : [cmd, cmdArgs];
  const result = spawnSync(file, fileArgs, { stdio: 'inherit' });
  if (result.status !== 0) fail(`${label} 실패 (exit ${result.status})`);
}

function printPlan(steps, settingsSteps) {
  console.log(dryRun ? '할 일(--dry-run, 실제로는 바꾸지 않음):' : '할 일:');
  for (const s of steps) console.log(`  - ${s}`);
  for (const s of settingsSteps) console.log(`  - ${s}`);
}

async function confirm(question) {
  if (yes) return true;
  if (!process.stdin.isTTY) fail('확인을 받을 수 없는 환경입니다. 내용을 확인했다면 --yes를 붙여 다시 실행하세요.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function fail(message) {
  console.error(`\n오류: ${message}`);
  process.exit(1);
}
