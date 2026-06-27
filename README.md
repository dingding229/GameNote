# Switch 游戏购买记录

一个本地、Sites 或 Docker 部署的 Nintendo Switch 游戏购买记录工具。Sites
部署时数据保存在 D1 数据库中；Docker/Next standalone 部署时数据保存在服务端
JSON 文件中。适合个人记录游戏名、价格、购买日期、版本、购买渠道、封面和卖出信息。

## 功能

- 新增、编辑、删除实体卡带或数字版购买记录
- 进入账本前需要输入访问密码
- 状态保留「实体卡带」和「数字版」
- 为实体卡带记录卖出日期、卖出价格和币种
- 按中文或英文游戏名调用 Nintendo 官方搜索数据获取封面候选，香港站结果会转成简体中文
- 粘贴 Nintendo 商品页自动提取 `og:image` 封面
- 按币种统计总支出和卖出回收
- 绑定任天堂账号资料，记录每个游戏的游玩时长
- 支持导入整理后的游玩时长 JSON 或 CSV，并按游戏名匹配到现有记录
- 搜索、排序、导出 JSON、导入 JSON
- Sites 部署时通过 D1 持久化服务端记录
- Docker 部署时通过 volume 持久化数据文件

## 本地运行

```bash
npm install
npm run dev
```

`npm run dev` 使用 Cloudflare Worker 入口和本地 D1 绑定，和 Sites 托管环境一致。

本地默认访问密码是：

```text
ns2026
```

可以通过 `.env` 覆盖：

```bash
APP_ACCESS_PASSWORD=你的密码
APP_ACCESS_SESSION_SECRET=任意长随机字符串
APP_DATA_FILE=records.json
```

开发服务器默认地址：

```text
http://localhost:3000/
```

## Sites 部署构建

Sites 托管环境使用 D1 保存记录，绑定名是 `DB`。部署构建建议使用精简产物命令：

```bash
npm run build:sites
```

这个命令会保留 `dist/server`、`dist/client`、`.openai/hosting.json` 和 D1 迁移，
但移除只给自托管 `vinext start` 使用的 `dist/standalone`，避免上传包膨胀。

## Docker 部署

先修改 `docker-compose.yml` 里的访问密码和会话密钥：

```yaml
environment:
  APP_ACCESS_PASSWORD: "你的访问密码"
  APP_ACCESS_SESSION_SECRET: "一段更长的随机字符串"
  APP_DATA_FILE: "/data/records.json"
```

启动：

```bash
docker compose up -d --build
```

访问：

```text
http://localhost:3000/
```

记录数据会写入宿主机的 `./data/records.json`，文件格式为：

```json
{
  "version": 1,
  "updatedAt": "2026-06-27T00:00:00.000Z",
  "account": {
    "displayName": "Nintendo 昵称",
    "friendCode": "SW-0000-0000-0000",
    "linkedAt": "2026-06-27T00:00:00.000Z",
    "playtimeUpdatedAt": "2026-06-27T00:00:00.000Z"
  },
  "records": []
}
```

## 游玩时长导入

任天堂没有提供可供这个应用直接绑定账号并读取时长的公开 Web API。当前实现不会收集任天堂账号密码，也不会抓取网页登录态。你可以在 Nintendo Store App 的 Play Activity 中查看官方游玩记录后，整理为 JSON 或 CSV 导入。

JSON 示例：

```json
[
  {
    "title": "塞尔达传说 旷野之息",
    "playTimeHours": 120,
    "firstPlayedDate": "2024-10-02",
    "lastPlayedDate": "2026-06-27"
  }
]
```

CSV 示例：

```csv
title,playTime,firstPlayedDate,lastPlayedDate
塞尔达传说 旷野之息,120小时,2024-10-02,2026-06-27
```

## 验证

```bash
npm run lint
npm run build
```

## 说明

封面接口优先使用腾讯 Nintendo Switch 大陆官网公开数据以支持大陆译名，
香港站和 Nintendo 美国搜索数据作为兜底。商品页提取限制访问 Nintendo
官方域名。
