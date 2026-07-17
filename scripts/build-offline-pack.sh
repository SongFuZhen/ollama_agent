#!/usr/bin/env bash
set -euo pipefail
# 构建内网离线部署包：源码 + Ollama 二进制(三平台) + 已导出编码模型 + 安装脚本
OUT=dist/ollama_agent-offline
rm -rf "$OUT" && mkdir -p "$OUT"/{bin,models,src}
cp -r src package.json public "$OUT/src" 2>/dev/null || cp -r src package.json "$OUT/src"
# 导出本地已拉取编码模型（embedding 模型为可选，默认不打包）
for m in qwen2.5-coder:7b; do
  ollama show --modelfile "$m" >/dev/null 2>&1 && echo "packing $m" && \
    (ollama pull "$m" >/dev/null 2>&1; cp -r ~/.ollama/models/* "$OUT/models" 2>/dev/null || true)
done
cat > "$OUT/install.sh" <<'EOF'
#!/usr/bin/env bash
# 离线安装：解压后 ./install.sh 即启动（无需 npm install）
cd "$(dirname "$0")"
[ -x bin/ollama ] || echo "请将对应平台 ollama 二进制放入 bin/"
echo "运行:  MODEL=qwen2.5-coder:7b node src/server.js"
EOF
chmod +x "$OUT/install.sh"
tar -czf "$OUT.tar.gz" -C dist ollama_agent-offline
echo "built $OUT.tar.gz"
