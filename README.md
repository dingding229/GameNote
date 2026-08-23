# GameNote

GameNote 是一个面向个人部署的游戏收藏与购买记录应用，支持 Nintendo Switch、PlayStation、PS Plus 游戏目录、会员记录、价格统计、JSON 备份和 AI 订单截图识别。

应用采用 Next.js、React、TypeScript 与 SQLite 构建，默认通过 Docker Compose 部署。游客可以只读浏览收藏，管理员登录后才能修改数据和使用管理工具。

## 主要功能

### 游戏收藏

- Nintendo Switch 与 PlayStation 独立游戏库。
- 记录游戏名称、平台、实体/数字版、版本地区、买入价格、币种、购买日期、渠道和备注。
- 实体游戏可记录卖出日期、价格和币种。
- 封面网格和紧凑列表两种展示方式。
- 支持名称搜索、排序、平台统计和人民币汇率折算。
- 繁体中文标题自动规范为简体中文，搜索时进行繁简归一化。

### 官方数据查询

- Nintendo 香港、国行及 Nintendo 官方数据源的游戏名称、封面、页面与部分数字版价格。
- PlayStation 香港商店的游戏名称、封面、官方页面和价格。
- 可按游戏名称搜索，也可粘贴官方页面 URL 获取数据。
- 官方页面或接口改版后，相应解析规则可能需要更新。

### PS Plus 与会员

- PS Plus 游戏库独立页面，展示港区升级与高级会员目录、中文名、封面和支持平台。
- PS Plus 目录使用 SQLite 缓存，默认每 12 小时后台刷新一次；管理员可以手动刷新。
- 可记录 PlayStation Plus 和 Nintendo Switch Online 的启用状态及到期日期。
- 可从 PlayStation Blog 获取本月 PS Plus 会免游戏，去重后自动加入收藏。

### AI 购买截图识别

- 支持兼容 OpenAI Responses API 的视觉服务。
- AI 地址、API Key 和视觉模型全部在管理员“设置”页面维护，不需要写入 Docker Compose。
- 设置页面支持“获取模型”和“测试接口”。
- AI 配置成功后显示“识别购买图”入口。
- 一次最多上传 6 张 JPEG、PNG 或 WebP 图片，单张不超过 12MB。
- 识别结果加入收藏前可以修改平台、价格、版本、形态、渠道和日期。

### 设置与备份

- 设置网站标题、头像和满足可读性要求的主题色。
- 选择侧边栏需要展示的 Nintendo Switch、PlayStation、PS Plus 游戏库和会员工具。
- JSON 导入和导出统一位于“设置 → 数据备份”。
- JSON 文件最大 5MB，最多包含 2,000 条记录。
- 收藏分享图支持价格、购买日期、卖出信息和备注；单张图最多展示前 160 条记录，并限制封面加载并发数。

### 账户与数据安全

- 首次使用时注册唯一管理员账号。
- 密码使用异步 scrypt 哈希，不保存明文。
- 登录失败按客户端地址与账号限流。
- 会话 Cookie 使用 HttpOnly、SameSite=Strict 和签名 JWT。
- 修改密码会立即撤销全部旧登录会话，并要求重新登录。
- 收藏保存使用 `updatedAt` 乐观锁，避免多个页面或 PS Plus 同步相互覆盖数据。
- 分享图封面代理仅允许已登录管理员访问，只接受通过文件签名校验的 JPEG、PNG、WebP 和 AVIF。

## 页面与权限

| 页面或操作                 | 游客 | 管理员 |
| -------------------------- | :--: | :----: |
| 浏览 NS / PlayStation 收藏 |  ✓   |   ✓    |
| 浏览 PS Plus 游戏库        |  ✓   |   ✓    |
| 新增、编辑、删除记录       |      |   ✓    |
| 官方游戏数据查询           |      |   ✓    |
| AI 购买截图识别            |      |   ✓    |
| 会员记录和会免同步         |      |   ✓    |
| JSON 导入、导出与分享图    |      |   ✓    |
| 网站、内容与 AI 设置       |      |   ✓    |

## 快速部署

要求：Docker Engine 与 Docker Compose。

```bash
git clone https://github.com/dingding229/GameNote.git
cd GameNote
cp .env.example .env
openssl rand -base64 48
```

将最后一条命令输出的随机值填入 `.env`：

```dotenv
JWT_SECRET=在这里填写独立随机值
```

不要提交真实的 `.env` 或 JWT 密钥。随后构建并启动：

```bash
docker compose up -d --build
```

浏览器访问 `http://localhost:3000`。第一次访问时点击“注册管理员”，然后进入设置页面配置游戏库、会员信息及 AI 服务。

## Docker Compose 配置

仓库默认配置：

```yaml
services:
  gamenote:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: gamenote
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      PS_PLUS_CATALOG_REFRESH_HOURS: ${PS_PLUS_CATALOG_REFRESH_HOURS:-12}
      JWT_SECRET: ${JWT_SECRET:?请复制 .env.example 为 .env，并配置 JWT_SECRET}
      APP_DATABASE_FILE: "/data/records.sqlite"
    volumes:
      - ./data:/data
```

| 环境变量                        | 是否必需 | 默认值                 | 说明                                                           |
| ------------------------------- | :------: | ---------------------- | -------------------------------------------------------------- |
| `JWT_SECRET`                    |    是    | 无                     | JWT 会话签名密钥，生产环境至少 32 字节。修改后现有会话会失效。 |
| `APP_DATABASE_FILE`             |    否    | `/data/records.sqlite` | SQLite 数据库文件路径，Docker 配置已经写入。                   |
| `PS_PLUS_CATALOG_REFRESH_HOURS` |    否    | `12`                   | PS Plus 游戏目录缓存刷新间隔，单位为小时。                     |

以下内容不再通过环境变量维护：

- AI API 地址、API Key 和视觉模型。
- 需要展示或统计的游戏平台与工具。
- PS Plus 和 Nintendo Switch Online 会员状态。

它们均由管理员在应用设置中维护，并保存在 SQLite 中。

## 更新、日志与停止

```bash
# 更新并重新构建
git pull
docker compose down --remove-orphans
docker compose up -d --build

# 查看日志
docker compose logs -f gamenote

# 停止服务但保留数据
docker compose down
```

### 从旧版本升级

- Docker 服务名与容器名已统一为 `gamenote`；首次升级请执行上面的 `docker compose down --remove-orphans`，清理旧的 `switch-ledger` 容器后再启动。
- 数据库会自动增加会话版本字段，无需手工执行 SQL。
- 升级后旧版登录 Cookie 会失效，管理员重新登录一次即可。
- 旧版默认橙色对比度不足时会自动回退为新的深橙色；其他可访问主题色保持不变。
- 收藏数据与现有 AI、会员、展示设置不会被清空。

## 数据存储与备份

默认 SQLite 文件位于宿主机：

```text
./data/records.sqlite
```

推荐同时采用两种备份：

1. 定期在“设置 → 数据备份”中导出 JSON。
2. 停止容器后复制 `data/records.sqlite`。

JSON 备份可以在设置页面直接导入。SQLite 备份应在容器停止后替换，避免复制写入中的数据库文件。旧版 `records.json` 存在且 SQLite 尚无记录时，应用会尝试自动迁移。

## 本地开发与质量检查

要求 Node.js `>=22.13.0`。

```bash
npm ci
npx next dev -p 3017
```

访问 `http://localhost:3017`。开发数据默认写入 `data/records.sqlite`。

```bash
npm run format:check  # Prettier 格式检查
npm run lint          # ESLint + Next.js Core Web Vitals
npm run typecheck     # TypeScript 类型检查
npm run test          # Vitest 自动测试
npm run check         # 依次执行以上全部检查
npm run build:docker  # Next.js 生产构建
```

## 项目结构

```text
app/
  api/                         Next.js API 路由
  nintendo-switch/             Nintendo Switch 页面
  playstation/                 PlayStation 页面
  ps-plus-catalog/             PS Plus 游戏目录页面
  memberships/                 会员记录页面
features/ledger/
  components/                  工具栏、设置、会员和目录组件
  hooks/                       弹窗焦点与键盘复用逻辑
  ledger-client.tsx            收藏客户端入口与页面编排
  storage.ts                   浏览器端数据访问和导入规范化
  types.ts                     前端领域类型
  utils.ts                     统计、格式化和分享图工具
lib/
  auth/                        密码、登录限流、JWT 与访问校验
  game/                        标题规范化、翻译和官方名称解析
  ledger/                      数据限制、领域结构与 SQLite 仓储
  ui/                          主题色可读性工具
tests/                          Vitest 自动测试
public/                         静态资源
data/                           本地 SQLite 数据，不纳入版本控制
```

页面通过 `features/ledger/index.ts` 暴露收藏模块。API 路由负责 HTTP 输入输出，认证、领域校验、游戏标题解析和 SQLite 访问分别复用 `lib` 中的模块。

## 技术栈

- Next.js 16 / App Router / standalone output
- React 19
- TypeScript 5
- Tailwind CSS 4 / DaisyUI 5
- Node.js 内置 SQLite
- OpenCC 繁简转换
- Vitest / ESLint / Prettier
- Docker / Docker Compose

## 安全与部署建议

- 为每个部署生成不同的 `JWT_SECRET`，不要使用示例文本或短密码。
- 不要提交 `.env`、`data/records.sqlite` 或 JSON 备份。
- 公网部署应使用 HTTPS 反向代理，并在代理层增加速率限制和安全响应头。
- 登录限流保存在当前 Node 进程内；多实例部署时应改用 Redis 等共享限流存储。
- AI API Key 保存在本地 SQLite，请限制数据库文件权限并妥善备份。
- 定期执行 `npm audit`、`npm run check` 和生产构建检查。
- Nintendo、PlayStation、Wikidata、Google Translate 与 PlayStation Blog 不可用时，相应查询可能暂时降级；收藏读取不会等待外部标题翻译接口。
