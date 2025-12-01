# 使用官方 Node.js 镜像（Debian 版本，兼容性好于 Alpine）
FROM node:18-slim

# 安装必要的系统库（为了 Sharp 和 FFmpeg 运行更稳定）
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# 设置工作目录
WORKDIR /app

# 1. 先只复制 package.json，利用 Docker 缓存加速构建
COPY package.json ./

# 2. 安装依赖 (npm 会自动下载适合 Linux 的 sharp 和 ffmpeg)
# 加上 --omit=dev 可以减少体积
RUN npm install --omit=dev

# 3. 复制源代码
COPY server.js ./
COPY public ./public

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["node", "server.js"]