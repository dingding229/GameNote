# Switch 游戏购买记录

一个本地运行的 Nintendo Switch 游戏购买记录工具。数据保存在浏览器
`localStorage` 中，适合个人记录游戏名、价格、购买日期、版本、购买渠道、封面和卖出信息。

## 功能

- 新增、编辑、删除实体卡带或数字版购买记录
- 进入账本前需要输入访问密码
- 状态保留「实体卡带」和「数字版」
- 为实体卡带记录卖出日期、卖出价格和币种
- 按中文或英文游戏名调用 Nintendo 官方搜索数据获取封面候选，香港站结果会转成简体中文
- 粘贴 Nintendo 商品页自动提取 `og:image` 封面
- 按币种统计总支出和卖出回收
- 搜索、排序、导出 JSON、导入 JSON

## 本地运行

```bash
npm install
npm run dev
```

本地默认访问密码是：

```text
ns2026
```

可以通过 `.env` 覆盖：

```bash
APP_ACCESS_PASSWORD=你的密码
APP_ACCESS_SESSION_SECRET=任意长随机字符串
```

开发服务器默认地址：

```text
http://localhost:3000/
```

## 验证

```bash
npm run lint
npm run build
```

## 说明

封面接口优先使用 Nintendo 香港软件页的公开数据以支持中文游戏名搜索，
并保留 Nintendo 美国搜索数据作为英文兜底。商品页提取限制访问 Nintendo
官方域名。
