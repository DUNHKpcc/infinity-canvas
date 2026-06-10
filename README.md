<p align="center">
  <img src="web/public/logo.png" width="96" alt="infinity-canvas logo">
</p>

<h1 align="center">无限画布 · infinity-canvas</h1>

<p align="center">
  <a href="https://render.com/deploy?repo=https://github.com/DUNHKpcc/infinity-canvas"><img src="https://img.shields.io/badge/Render-Deploy-46e3b7?style=flat-square&logo=render&logoColor=111111" alt="Deploy to Render"></a>
  <a href="https://github.com/DUNHKpcc/infinity-canvas"><img src="https://img.shields.io/github/stars/DUNHKpcc/infinity-canvas?style=flat-square&logo=github" alt="GitHub stars"></a>
  <a href="VERSION"><img src="https://img.shields.io/badge/version-v0.2.4-2563eb?style=flat-square" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-f97316?style=flat-square" alt="License"></a>
  <a href="https://www.docker.com/"><img src="https://img.shields.io/badge/Docker-ready-2496ed?style=flat-square&logo=docker&logoColor=white" alt="Docker ready"></a>
  <a href="https://nextjs.org/"><img src="https://img.shields.io/badge/Next.js-16.2-000000?style=flat-square&logo=nextdotjs" alt="Next.js"></a>
  <a href="https://go.dev/"><img src="https://img.shields.io/badge/Go-1.25-00add8?style=flat-square&logo=go&logoColor=white" alt="Go"></a>
</p>

无限画布是一款面向图片创作的开源工作台。它把画布编排、AI 图片生成、参考图编辑、对话助手、提示词库和素材沉淀放在同一个界面里，适合用来探索视觉方案并连续迭代图片结果。

> [!NOTE]
> 本仓库基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 二次开发，使用 AGPL-3.0 协议继续开源。
> 主要差异：自定义品牌（logo / favicon）、Docker 基础镜像使用 daocloud 镜像源以适配国内网络。

> [!CAUTION]
> 项目处于开发阶段，不保证历史数据兼容。表结构与存储格式可能直接调整，当前更适合个人/本地部署，不建议直接公网多人共用。

## 核心功能

- 无限画布：多画布项目、节点拖拽缩放、连线、小地图、撤销重做、导入导出。
- AI 创作：支持 OpenAI 兼容接口的文生图、图生图、参考图编辑、文本问答和视频生成；Seedance 2.0 可通过火山方舟 Agent Plan 接入。
- 画布助手：围绕选中节点和上游节点对话、生图，并把结果插回画布。
- 提示词库：抓取多个 GitHub 开源项目，按案例整理数百个图片提示词。
- 用户头像：账户菜单「用户详情」支持上传自定义头像，自动裁剪压缩为 webp 并持久化。

完整功能说明见 [docs/features.md](docs2/features.md)。

## 技术栈

- 前端：Next.js、React、TypeScript、Tailwind CSS、Ant Design、Zustand、TanStack Query。
- 后端：Go、Gin、GORM。
- 部署：Docker。

## 快速开始

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/DUNHKpcc/infinity-canvas)

```bash
git clone https://github.com/DUNHKpcc/infinity-canvas.git
cd infinity-canvas
cp .env.example .env
# 修改默认账号密码等信息
docker compose up -d
```

本地源码构建运行：

```bash
cp .env.example .env
docker compose -f docker-compose.local.yml up -d --build
```

运行后默认端口 3000，访问 `http://localhost:3000`，默认账号 `admin / infinite-canvas`。

如需要拉取提示词，可前往:`http://localhost:3000/admin/prompts`

## New API 自动配置

如果使用 New API，可在 `系统设置 -> 聊天方式 -> 添加聊天设置` 中填入：

```text
https://infinite-canvas-cpco.onrender.com?apiKey={key}&baseUrl={address}
```

跳转后会自动打开配置弹窗并填入 API Key 和 Base URL。
如果自己部署了，可以把 `https://infinite-canvas-cpco.onrender.com` 替换成你部署的地址。

## 效果展示

<table width="100%">
  <tr>
    <td width="50%"><img src="https://i.ibb.co/TDFvGWDT/image.png" alt="image" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/zVwJq3YS/image.png" alt="image" border="0"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://i.ibb.co/PvY3qhhK/image.png" alt="image" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/7D04LwN/image.png" alt="image" border="0"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://i.ibb.co/bj30FtS5/5.png" alt="5" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/hxRvjw51/image.png" alt="image" border="0"></td>
  </tr>
</table>

## 文档

- [功能介绍](docs2/features.md)
- [部署说明](docs2/deployment.md)
- [画布节点操作手册](docs2/canvas-node-manual.md)
- [画布快捷键](docs2/canvas-shortcuts.md)
- [待办事项](docs2/todo.md)
- [后端数据库说明](docs2/backend-database.md)
- [系统配置数据结构](docs2/system-settings.md)
- [接口响应约定](docs2/api-response.md)

## 致谢

本项目派生自 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)，感谢原作者的开源贡献。原项目的核心功能与文档由原作者完成，本仓库仅做品牌定制与本地化适配。

## 开源协议

本项目使用 GNU Affero General Public License v3.0，见 [LICENSE](LICENSE)。AGPL 要求：你若将本程序（或其修改版）作为网络服务部署给他人使用，必须同时向用户公开本程序的完整源代码下载链接。

## Star History

<a href="https://www.star-history.com/?repos=DUNHKpcc%2Finfinity-canvas&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=DUNHKpcc/infinity-canvas&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=DUNHKpcc/infinity-canvas&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=DUNHKpcc/infinity-canvas&type=date&legend=top-left" />
 </picture>
</a>
