'use strict';

const fsp = require('fs/promises');
const path = require('path');
const readline = require('readline');
const { createReadStream } = require('fs');
const { PROJECT_ROOT, safeResolve } = require('./utils');

/**
 * 递归搜索文件内容
 */
async function grepDir(dir, regex, root, options, results = []) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    // 跳过 node_modules 和 .开头的目录
    if (entry.isDirectory() && (entry.name === 'node_modules' || entry.name.startsWith('.'))) {
      continue;
    }
    
    if (entry.isDirectory()) {
      await grepDir(fullPath, regex, root, options, results);
    } else if (entry.isFile()) {
      // 跳过常见二进制文件
      if (/\.(png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|mp3|mp4|zip|tar|gz)$/i.test(entry.name)) {
        continue;
      }
      
      await grepFile(fullPath, regex, root, options, results);
    }
  }
  
  return results;
}

/**
 * 搜索单个文件
 */
async function grepFile(filePath, regex, root, options, results) {
  const relPath = path.relative(root, filePath);
  const fileResults = [];
  let lineNum = 0;
  let matchCount = 0;
  
  try {
    const rl = readline.createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    
    for await (const line of rl) {
      lineNum++;
      
      if (options.maxCount && matchCount >= options.maxCount) {
        break;
      }
      
      const matches = options.onlyCount ? null : line.match(regex);
      if (matches) {
        matchCount++;
        fileResults.push({
          line: lineNum,
          content: line.trim(),
          match: matches[0],
        });
      }
    }
    
    if (matchCount > 0) {
      results.push({
        file: relPath,
        count: matchCount,
        lines: fileResults.slice(0, options.maxResults || 100),
      });
    }
  } catch (e) {
    // 跳过无法读取的文件
  }
}

module.exports = {
  name: 'grep',
  desc: '搜索文件内容（支持正则表达式）',
  params: { 
    pattern: '搜索模式（支持正则表达式）',
    path: '搜索目录，默认项目根',
    include: '文件名过滤，可选（如 *.js）',
  },
  needConfirm: false,
  
  async run({ pattern, path: p, include }, ctx = {}) {
    const root = ctx.root || PROJECT_ROOT;
    const searchDir = p ? await safeResolve(p, root) : root;
    
    let regex;
    try {
      regex = new RegExp(pattern, 'gi');
    } catch (e) {
      return `无效的正则表达式: ${e.message}`;
    }
    
    const options = {
      maxCount: 1000,
      maxResults: 100,
    };
    
    let results = await grepDir(searchDir, regex, root, options);
    
    // 如果指定了 include 过滤
    if (include) {
      const includeRegex = new RegExp(include.replace(/\*/g, '.*'));
      results = results.filter(r => includeRegex.test(r.file));
    }
    
    if (results.length === 0) {
      return '未找到匹配内容';
    }
    
    // 格式化输出
    const lines = [];
    let totalMatches = 0;
    
    for (const file of results.slice(0, 50)) {
      totalMatches += file.count;
      lines.push(`\n📄 ${file.file} (${file.count} 处匹配):`);
      
      for (const match of file.lines.slice(0, 10)) {
        lines.push(`  ${match.line}: ${match.content}`);
      }
      
      if (file.count > 10) {
        lines.push(`  ... 还有 ${file.count - 10} 处匹配`);
      }
    }
    
    if (results.length > 50) {
      lines.push(`\n... 还有 ${results.length - 50} 个文件包含匹配`);
    }
    
    lines.unshift(`找到 ${totalMatches} 处匹配，涉及 ${results.length} 个文件`);
    return lines.join('\n');
  },
};
