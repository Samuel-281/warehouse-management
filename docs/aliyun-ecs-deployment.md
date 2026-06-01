# 阿里云 ECS 同机部署说明

## 1. 部署目标

本方案用于仓库货物管理系统 1.0 试运行/正式运行：网站、Next.js API 和 PostgreSQL 数据库部署在同一台阿里云 ECS 上。外部用户只访问网站端口，数据库不开放公网端口。

推荐初始配置：

| 项目 | 建议 |
| --- | --- |
| ECS 规格 | 2 vCPU / 4 GiB / 40 GiB 起步 |
| 地域 | 香港或业务人员访问较稳定的地域 |
| 面板 | 可预装宝塔 Linux 面板 |
| 运行组件 | Node.js 20、PostgreSQL、Nginx、PM2 |
| 开放端口 | 22、80、443，宝塔端口按需限制访问 |
| 禁止公网开放 | 3000、5432 |

## 2. 服务器准备

1. 创建 ECS 后先设置强密码或 SSH 密钥。
2. 安全组只保留必要端口：`22`、`80`、`443`。宝塔面板端口如需开放，建议只允许自己的固定 IP 访问。
3. 在宝塔或命令行安装：
   - Node.js 20
   - PostgreSQL
   - Nginx
   - PM2
4. 创建项目目录，例如：

```bash
mkdir -p /www/wwwroot/warehouse-management
```

## 3. 数据库准备

在 ECS 本机创建数据库和应用账号：

```sql
CREATE DATABASE warehouse_management;
CREATE USER warehouse_app WITH PASSWORD '请替换为强密码';
GRANT ALL PRIVILEGES ON DATABASE warehouse_management TO warehouse_app;
```

PostgreSQL 应只监听本机或内网，不要在安全组中开放 `5432`。

## 4. 部署代码

在服务器项目目录拉取 GitHub 私有仓库：

```bash
cd /www/wwwroot/warehouse-management
git clone <你的仓库地址> .
cd warehouse-web
npm install
```

复制生产环境变量示例：

```bash
cp .env.ecs.example .env
```

编辑 `.env`，替换 `DATABASE_URL` 中的数据库密码。

## 5. 初始化数据库

首次部署时执行：

```bash
npm run db:deploy
npm run db:seed
```

`db:seed` 会写入初始账号和基础数据。上线前必须登录超级管理员账号，在系统维护中创建真实账号，或直接在数据库中修改初始账号密码。

## 6. 构建和启动

```bash
npm run build
pm2 start npm --name warehouse-web -- run start
pm2 save
```

确认本机可访问：

```bash
curl http://127.0.0.1:3000
```

## 7. Nginx 反向代理

在宝塔网站配置或 Nginx 配置中，将域名反向代理到：

```text
http://127.0.0.1:3000
```

如果暂时没有域名，也可以先用 ECS 公网 IP 访问 `http://服务器IP`。若使用中国内地区域和域名，需要先完成备案；香港区域通常不需要 ICP 备案。

## 8. 备份

建议每天执行一次 PostgreSQL 逻辑备份，至少保留 7 天。

示例命令：

```bash
mkdir -p /www/backup/warehouse-management
pg_dump "postgresql://warehouse_app:数据库密码@127.0.0.1:5432/warehouse_management" | gzip > "/www/backup/warehouse-management/warehouse_$(date +%F_%H%M).sql.gz"
```

宝塔计划任务中可配置每日执行。正式使用前至少做一次恢复演练，确认备份文件可用。

## 9. 上线检查

上线后检查：

1. 只能通过 `80/443` 访问网站。
2. 公网不能访问 `3000` 和 `5432`。
3. 三类账号权限正确。
4. 入库、出库、销售退回、库存查询和单据导出正常。
5. 正式环境下网页端数据重置入口不可执行。
6. 备份任务已启用，并能生成备份文件。
