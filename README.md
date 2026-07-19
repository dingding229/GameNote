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
- 统计范围可配置：可通过 Docker Compose 选择只统计 NS、只统计 PS，或两个平台都统计。
- JSON 导入/导出：便于迁移和备份。
- 访问密码保护：适合私人使用，不暴露给公网匿名访问。

## 快速开始

先克隆仓库：

```bash
git clone https://github.com/dingding229/GameNote.git
cd GameNote
```

编辑 `docker-compose.yml`，至少修改这两个值：

```yaml
APP_ACCESS_PASSWORD: "请修改为你的访问密码"
APP_SECRET: "请修改为一段更长的随机字符串"
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
      APP_ACCESS_PASSWORD: "请修改为你的访问密码"
      APP_SECRET: "请修改为一段更长的随机字符串"
      APP_DATABASE_FILE: "/data/records.sqlite"
      APP_STATS_PLATFORMS: "all"
    volumes:
      - ./data:/data
```

环境变量说明：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `APP_ACCESS_PASSWORD` | 登录访问密码 | 本地开发有内置默认值，部署时必须修改 |
| `APP_SECRET` | 会话签名密钥 | 未配置时会回退到访问密码，部署时必须单独设置 |
| `APP_DATABASE_FILE` | SQLite 数据库路径 | `/data/records.sqlite` |
| `APP_STATS_PLATFORMS` | 首页统计范围 | `all` |

`APP_STATS_PLATFORMS` 可选值：

| 值 | 统计范围 |
| --- | --- |
| `all` 或 `both` | Nintendo Switch + PlayStation |
| `ns` | 仅 Nintendo Switch |
| `ps` | 仅 PlayStation |

修改环境变量后重启容器：

```bash
docker compose up -d
```

如果改了源码或依赖，重新构建：

```bash
docker compose up -d --build
```

## 使用方式

1. 进入首页后输入访问密码。
2. 在顶部切换 Nintendo Switch 或 PlayStation 页面。
3. 点击“新增游戏”，手动填写游戏信息。
4. 输入游戏名后可点击“按名称找官方数据”，也可以填入官方页面 URL 后点击“从页面取数据”。
5. 从候选结果中选择正确游戏，系统会填入标题、封面、官方链接，能获取价格时也会填入价格。
6. 实体游戏卖出后，可在记录卡片上点击“记录卖出”。
7. 使用“导出 JSON”定期备份，也可以通过“导入 JSON”迁移记录。

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

- 部署前一定要修改 `APP_ACCESS_PASSWORD` 和 `APP_SECRET`。
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
