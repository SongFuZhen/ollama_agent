'use strict';

const { execSync } = require('child_process');
const path = require('path');
const { PROJECT_ROOT } = require('./utils');
const { detectShell, adaptReadonlyCommand } = require('./shell');

const IS_WIN = process.platform === 'win32';
// Windows 上交给 cmd.exe 解析；Unix 上用 /bin/sh。
// 用 shell:true 让 Node 自己选平台 shell，避免硬编码。
function shellOpts(extra) {
  return Object.assign({ shell: true, cwd: extra.cwd, timeout: 30000, maxBuffer: 1024*1024, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }, {});
}

// 只读/安全命令白名单：命中且无可疑参数时直接放行，无需逐项黑名单匹配。
// 仅匹配基础命令名（第一个 token），且其后不得出现写类重定向。
const SAFE_READONLY = new Set([
  'echo', 'cat', 'head', 'tail', 'less', 'more', 'nl', 'wc', 'sort', 'uniq',
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'awk', 'sed', 'cut', 'tr', 'paste',
  'ls', 'll', 'pwd', 'cd', 'find', 'tree', 'glob', 'readlink', 'realpath',
  'file', 'stat', 'du', 'df', 'free', 'uptime', 'uname', 'whoami', 'id',
  'env', 'printenv', 'which', 'type', 'git', 'node', 'npm', 'npx',
  'python', 'python3', 'jq', 'xxd', 'od', 'base64', 'date', 'cal',
]);

// Windows 只读等价集：只放 Windows 真的有的命令（不含 cat/ls/grep 等）。
const SAFE_READONLY_WIN = new Set([
  'echo', 'type', 'dir', 'cd', 'pwd', 'find', 'sort', 'more', 'cls', 'ver',
  'whoami', 'hostname', 'ipconfig', 'tree', 'path', 'set', 'date', 'time',
  'where', 'fc', 'comp', 'systeminfo', 'tasklist', 'net', 'ping', 'tracert',
]);

// 破坏性命令黑名单（正则片段匹配，覆盖子目录/各种写法；统一忽略大小写，
// 因为命令在匹配前已 toLowerCase，否则 -R 等标志会被小写化后漏匹配）
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+(\/|\$home|~)/i,  // rm -rf /... 删根/家目录
  /\brm\s+-[a-z]*[rf][a-z]*\s+(\/|\$home|~)/,       // rm -r /... 删根/家目录/绝对路径（不误伤 ./build）
  /\bmkfs\b/i,                                           // 格式化文件系统
  /\bdd\b\s+.*\bof=\/dev\//i,                          // dd 写入设备
  /\bchmod\s+-r\b/i,                                     // 递归改权限
  /\bchmod\s+-r\s+777\b/i,
  /\bchown\s+-r\b/i,                                     // 递归改属主
  /\bmv\b\s+.*\s+\/\S*$/,                               // 移动文件到根下（高危）
  /:\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,  // fork bomb
  />\s*\/dev\/(sd|hd|nvme|vd)\w+/,                    // 重定向覆写块设备
  /\b(shutdown|reboot|halt|poweroff)\b/i,
  /\bwipefs\b/i, /\bformat\b/i,
  // Windows 特有破坏性写法
  /\bdel\s+\/[sq]\b/i,                              // del /s /q 递归删除
  /\bdel\s+[a-z]:[\\/]/i,                          // del C:\... 删磁盘
  /\brd\s+\/[sq]\b/i,                              // rd /s 递归删目录
  /\bformat\s+[a-z]:/i,                           // format C: 格式化磁盘
  /\bcipher\s+\/w/i,                              // cipher /w 安全擦除
  />[a-z]:[\\/]/i,                               // 重定向覆写磁盘根（> C:\...）
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+[a-z]:[\\/]/i,  // rm -rf C:\
  /\bconvert\s+[a-z]:/i,                         // convert C: 磁盘转换/格式化类
];

// 把命令拆成 shell token（宽松分词，足以拦截常见危险写法）
function tokenize(cmd) {
  const stripped = cmd.replace(/#.*$/m, ' '); // 去掉 # 注释
  const raw = stripped.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return raw.map(t => t.replace(/^["']|["']$/g, '').trim()).filter(Boolean);
}

function isCommandBlocked(cmd) {
  const lower = cmd.toLowerCase().trim();

  // 1) 含危险元字符组合（命令替换、任意代码执行、重定向覆写块设备）一律拦截
  if (/[`$]\(|;\s*\w+\s*\(\s*\)\s*\{|>\s*\/dev\/sd/i.test(lower)) return true;

  // 2) 破坏性模式匹配
  if (DESTRUCTIVE_PATTERNS.some(re => re.test(lower))) return true;

  // 3) 白名单快路径：首个 token 是只读命令
  const tokens = tokenize(cmd);
  // base 提取：先去 Windows 盘符（C:\foo\bar -> foo\bar），再去掉 Unix 路径前缀
  let b = tokens[0] || '';
  if (/^[a-z]:\\?/i.test(b)) b = b.slice(3);
  const base = b.replace(/^[\w.\/-]*\//, '').split(' ')[0];
  const whitelist = IS_WIN ? SAFE_READONLY_WIN : SAFE_READONLY;
  if (whitelist.has(base)) {
    // 只读命令若重定向覆写块设备（> /dev/sd... 或 > C:\...）视为危险；普通 > file 由确认兜底
    if (/>\s*\/dev\//.test(lower) || />[a-z]:[\\/]/.test(lower)) return true;
    return false;
  }

  // 4) 其余（cp/mkdir/write 等写操作类）放行，由 needConfirm 二次确认兜底
  return false;
}

module.exports = {
  name: 'bash',
  desc: '执行 shell 命令（受限，禁止危险操作，需确认）；需要跑 git/构建/测试等内置工具未覆盖的命令时用',
  params: { command: '要执行的 shell 命令' },
  needConfirm: true,

  async run({ command }, ctx = {}) {
    if (!command || !command.trim()) {
      return '错误：命令不能为空';
    }

    // 检查危险命令
    if (isCommandBlocked(command)) {
      return '错误：该命令被安全策略阻止';
    }

    const cwd = ctx.root || PROJECT_ROOT;
    const shellInfo = detectShell();

    // 跨平台：Unix 只读命令（ls/cat 等）在 Windows 上替换为等价内建；
    // 无法等价的（grep/awk/sed/tree 等）拒绝，建议改用对应工具。
    let execCommand = command;
    if (shellInfo.isWin) {
      const adapted = adaptReadonlyCommand(command, shellInfo);
      if (adapted === null) {
        const base = command.trim().split(/\s+/)[0];
        return `错误：命令 "${base}" 在 Windows 上不可用。` +
          `请改用内置工具：查看目录用 list_dir，查看文件用 read_file，` +
          `搜索内容用 grep，统计行数用 count_loc。`;
      }
      execCommand = adapted;
    }

    try {
      const output = execSync(execCommand, Object.assign({}, shellInfo.shellOpts, {
        cwd,
        timeout: 30000, // 30秒超时
        maxBuffer: 1024 * 1024, // 1MB 输出限制
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }));

      return output || '(命令执行成功，无输出)';
    } catch (e) {
      const stdout = e.stdout || '';
      const stderr = e.stderr || '';
      const error = e.message || '';

      if (stdout || stderr) {
        return `退出码: ${e.status}\n${stdout}${stderr}`;
      }
      return `命令执行失败: ${error}`;
    }
  },
};
