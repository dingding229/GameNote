# Switch 卡带购买记录

一个本地运行的 Nintendo Switch 卡带购买记录工具。数据保存在浏览器
`localStorage` 中，适合个人记录游戏名、价格、购买日期、版本、购买渠道、备注和封面。

## 功能

- 新增、编辑、删除卡带购买记录
- 记录价格、币种、购买日期、版本、状态、渠道和备注
- 按游戏名调用 Nintendo 官方搜索数据获取封面候选
- 粘贴 Nintendo 商品页自动提取 `og:image` 封面
- 按币种统计总支出和入手均价
- 搜索、排序、导出 JSON、导入 JSON

## 本地运行

```bash
npm install
npm run dev
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

封面接口使用 Nintendo 官网前端公开使用的搜索数据，并限制商品页提取只访问
`nintendo.com` 域名。
