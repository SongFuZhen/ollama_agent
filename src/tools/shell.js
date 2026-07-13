'use strict';

// 跨平台 shell 探测与命令适配。
// 设计原则：让 Node 自己选择平台 shell（shell:true），
// 但把 Unix-only 的只读命令在 Windows 上映射到等价内置或拒绝，
// 以免 Windows 上白名单里的 cat/ls/grep 找不到二进制而整体失败。

const os = require('os');

function isWindows() {
  return process.platform === 'win32';
}

/**
 * 返回当前平台的 shell 配置：
 * { isWin, shell, shellFlag, and: 连接符, echo, listCmd }
 */
function detectShell() {
  const win = isWindows();
  return {
    isWin: win,
    // shell:true 时 Node 会用 cmd.exe (win) 或 /bin/sh (unix) 自动执行
    shell: true,
    // Windows 上禁止命令处理器自动运行（避免 profile 干扰），并提高健壮性
    shellOpts: win ? { shell: true, windowsHide: true } : { shell: true },
    // 多命令连接符
    and: win ? ' && ' : ' && ',
    // 等价 "echo" —— Windows 与 Unix 一致
    echo: 'echo',
    // 列出目录的内建命令（Windows 上 dir 才是内置；ls 很可能没有）
    listCmd: win ? 'dir' : 'ls',
    // 打印文件内容的内建命令
    catCmd: win ? 'type' : 'cat',
  };
}

/**
 * 把一个「Unix 只读命令」在 Windows 上做等价替换；
 * 若无法等价（无安全内置替代）则返回 null（调用方应拒绝并建议用对应工具）。
 *
 * 注意：这里只处理白名单里的只读探查命令，且只做最简单的前缀替换，
 * 复杂管线仍交给命令黑名单/确认兜底。
 */
function adaptReadonlyCommand(cmd, shellInfo) {
  if (!shellInfo.isWin) return cmd; // Unix 原样

  const trimmed = cmd.trim();
  const m = trimmed.match(/^([a-zA-Z0-9_./-]+)\b/); // 取第一个 token
  if (!m) return cmd;
  const base = m[1];

  const WIN_MAP = {
    ls: 'dir',
    ll: 'dir',
    cat: 'type',
    pwd: 'cd',
    uname: 'ver',
    // 以下 Windows 无安全内建等价，返回 null 由调用方拒绝
    grep: null,
    egrep: null,
    fgrep: null,
    rg: null,
    ag: null,
    awk: null,
    sed: null,
    tree: null,
    which: null,
    stat: null,
    du: null,
    df: null,
  };

  if (!(base in WIN_MAP)) return cmd; // 不在映射表（如 echo/git/node）原样
  const mapped = WIN_MAP[base];
  if (mapped === null) return null; // 无法等价
  // 替换首个 token
  return trimmed.replace(/^([a-zA-Z0-9_./-]+)/, mapped);
}

module.exports = {
  isWindows,
  detectShell,
  adaptReadonlyCommand,
};
