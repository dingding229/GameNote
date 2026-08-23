# GameNote

GameNote 是一个自部署的游戏购买记录工具，用来手动管理 Nintendo Switch 和 PlayStation 游戏的实体版、数字版、买入价格、卖出记录和封面信息。

项目当前以 Docker Compose 运行优先，数据保存在本地 SQLite 文件中，适合部署在自己的 NAS、服务器或本机 Docker 环境里。

## 功能

- 分平台页面：Nintendo Switch 和 PlayStation 使用独立页面展示。
- 手动记录：游戏名称、价格、币种、购买日期、地区版本、实体/数字版、渠道、备注。
- 实体游戏卖出记录：支持记录卖出日期、卖出价格和币种。
- 官方数据查询：
  - NS 游戏可从 Nintendo 香港、国行和 Nintendo 官方数据源查询封面与页面信息。
  - NS 香港数字版会尝试自动获取港服价格。
  - PS 游戏可从 PlayStation 香港商店查询游戏名称、封面、页面和价格。
- 繁简处理：获取到的繁体中文标题会自动转成简体中文，搜索时也会做繁简归一化。
- 地区版本：支持日版、港版、台版、美版、欧版、其他。
- 汇率折算：非人民币价格会折算为 CNY 统计。
- 双视图浏览：可在封面网格与紧凑列表之间切换。
- 收藏分享图：可将全部游戏生成一张图片，并选择是否显示价格、卖出信息、购买日期和备注。
- 统计范围可配置：可通过 Docker Compose 选择只统计 NS、只统计 PS，或两个平台都统计。
- JSON 导入/导出：便于迁移和备份。
- 管理员账号：首次访问时注册账号，登录后才能新增、编辑、删除、导入、导出或分享。
- 游客浏览：未登录可直接查看游戏收藏，但不能修改数据。
- 购买截图识别：管理员可上传订单截图，通过 AI 识别游戏、实付价格、平台、版本、形态和购买渠道，确认后批量添加。
- PS Plus 会免：可在设置中启用会员并填写到期日，自动从官方 PlayStation Blog 同步每月可领取游戏并去重入库。
- PS Plus 游戏库：独立页面展示港区完整升级 / 高级游戏目录、中文名、封面与平台；后台定时更新，管理员也可手动刷新。
- 会员记录：记录 Nintendo Switch Online 与 PlayStation Plus 到期时间，并可单独控制 PS Plus 每月会免是否自动入库。

## 项目结构

```text
app/                    Next.js 页面、布局和 API 路由
features/ledger/        游戏收藏前端业务模块
  components/           功能模块专用页面与组件
  ledger-client.tsx     游戏收藏客户端入口
  storage.ts            浏览器与 API 数据访问
  types.ts              前端领域类型
  utils.ts              前端业务工具
lib/auth/               登录、密码与会话能力
lib/config/             服务端应用配置
lib/game/               游戏名称规范化与解析
lib/ledger/             收藏记录结构与 SQLite 仓储
public/                 静态资源
data/                   SQLite 数据目录，不纳入版本控制
```

页面应通过 `features/ledger/index.ts` 使用游戏收藏模块，避免直接依赖模块内部组件。API 路由只负责 HTTP 输入输出，认证、标题处理和数据库访问分别复用 `lib` 下对应模块。

## 快速开始

先克隆仓库：

```bash
git clone https://github.com/dingding229/GameNote.git
cd GameNote
```

编辑 `docker-compose.yml`，修改 JWT 签名密钥：

```yaml
JWT_SECRET: "请修改为一段足够长的随机字符串"
```

启动服务：

```bash
docker compose up -d --build
```

访问：

```text
http://localhost:3000
```

## Docker Compose 配置

`docker-compose.yml` 默认配置如下：

```yaml
services:
  switch-ledger:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: switch-ledger
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      PS_PLUS_CATALOG_REFRESH_HOURS: ${PS_PLUS_CATALOG_REFRESH_HOURS:-12}
      JWT_SECRET: "请修改为一段足够长的随机字符串"
      OPENAI_API_KEY: "请填写 OpenAI API Key"
      OPENAI_VISION_MODEL: "gpt-4.1-mini"
      APP_DATABASE_FILE: "/data/records.sqlite"
      APP_STATS_PLATFORMS: "all"
    volumes:
      - ./data:/data
```

环境变量说明：

| 变量                            | 说明                                     | 默认值                 |
| ------------------------------- | ---------------------------------------- | ---------------------- |
| `JWT_SECRET`                    | JWT 会话签名密钥                         | 生产环境必须配置       |
| `PS_PLUS_CATALOG_REFRESH_HOURS` | PS Plus 完整游戏目录后台刷新间隔（小时） | `12`                   |
| `OPENAI_API_KEY`                | OpenAI API Key，用于购买截图识别         | 未配置时关闭识别能力   |
| `OPENAI_VISION_MODEL`           | 支持图像输入的 OpenAI 模型               | `gpt-4.1-mini`         |
| `APP_DATABASE_FILE`             | SQLite 数据库路径                        | `/data/records.sqlite` |
| `APP_STATS_PLATFORMS`           | 首页统计范围                             | `all`                  |

`APP_STATS_PLATFORMS` 可选值：

| 值              | 统计范围                      |
| --------------- | ----------------------------- |
| `all` 或 `both` | Nintendo Switch + PlayStation |
| `ns`            | 仅 Nintendo Switch            |
| `ps`            | 仅 PlayStation                |

修改环境变量后重启容器：

```bash
docker compose up -d
```

如果改了源码或依赖，重新构建：

```bash
docker compose up -d --build
```

## 使用方式

1. 第一次访问时点击“注册管理员”，创建账号和密码；账号信息会保存在 SQLite 中。
2. 未登录用户可以直接浏览；登录管理员后才会显示管理操作。
3. 在顶部切换 Nintendo Switch 或 PlayStation 页面。
4. 点击“新增游戏”，手动填写游戏信息。
5. 也可以点击“识别购买图”，上传最多 6 张订单截图；检查 AI 返回的价格、平台和版本后添加所选记录。
6. 输入游戏名后可点击“按名称找官方数据”，也可以填入官方页面 URL 后点击“从页面取数据”。
7. 从候选结果中选择正确游戏，系统会填入标题、封面、官方链接，能获取价格时也会填入价格。
8. 实体游戏卖出后，可在记录卡片上点击“记录卖出”。
9. 使用“导出 JSON”定期备份，也可以通过“导入 JSON”迁移记录。

## 数据存储与备份

数据默认保存在宿主机的：

```text
./data/records.sqlite
```

备份方式：

- 在页面中点击“导出 JSON”。
- 或停止容器后复制 `data/records.sqlite`。

停止服务：

```bash
docker compose down
```

保留数据的情况下更新服务：

```bash
git pull
docker compose up -d --build
```

## 本地构建检查

项目要求 Node.js `>=22.13.0`。

```bash
npm ci
npm run build:docker
```

本地构建会生成 `node_modules` 和 `.next`，它们不是源码的一部分。Docker 构建会在镜像内重新安装依赖并生成生产构建。

## 安全注意

- 部署前一定要设置足够长且随机的 `JWT_SECRET`；修改后所有现有登录会话会失效。
- 不要把 `data/records.sqlite` 提交到 Git。
- 不建议直接暴露到公网；如果需要公网访问，建议放在反向代理后面，并启用 HTTPS。
- 官方数据查询依赖 Nintendo、PlayStation 页面结构和接口，官网改版时可能需要更新解析逻辑。

## 技术栈

- Next.js
- React
- TypeScript
- Tailwind CSS / DaisyUI
- SQLite
- Docker / Docker Compose
- OpenCC 繁简转换
