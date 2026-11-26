# 二次元游戏情报站 · 静态站（GitHub Pages）

这是「二次元游戏情报站」的**纯静态版本**，用于部署到 GitHub Pages（`yuxiaoyang738-stack.github.io`）。

本地全栈版（FastAPI + SQLite）请见仓库根目录；本目录 `site/` 是前端 + 静态数据快照，可直接由任意静态服务器（含 GitHub Pages）托管。

## 目录结构

```
site/
  index.html          页面入口
  css/                样式
  js/                 前端逻辑（自动检测后端/静态模式）
  assets/             封面图、logo 等静态资源
  data/games.json     全部游戏列表快照
  data/stats.json     全局统计快照
  data/details/*.json 每款游戏详情快照
```

## 工作原理

前端 `js/app.js` 启动时会探测 `/health`：

- 有后端（本地 FastAPI）→ 走 `/api/*` 接口
- 无后端（GitHub Pages 等静态环境）→ 自动读取 `data/*.json` 快照，筛选/搜索/排序在前端本地完成

## 更新数据

在项目根目录运行：

```bash
python scripts/deploy_ghpages.py --push
```

它会：导出最新数据快照 → 同步前端到 `site/` → git 提交并推送。
