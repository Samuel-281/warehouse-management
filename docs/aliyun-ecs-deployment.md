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

## 8. OSS 自动备份

### 8.1 创建 OSS 和 RAM 角色

1. 在阿里云 OSS 创建与 ECS 同地域的私有 Bucket，不要开启公共读写。
2. 为 `warehouse-management/` 前缀设置生命周期规则：对象保存 30 天后自动删除。
3. 创建 ECS 实例 RAM 角色并绑定当前 ECS。角色只授予目标 Bucket 和前缀的 `oss:PutObject`、`oss:GetObject`、`oss:ListObjects` 权限。
4. 不创建或保存长期 AccessKey。`ossutil` 通过 ECS RAM Role 获取临时凭据。

参考：[ossutil 使用 ECS RAM Role](https://help.aliyun.com/en/oss/developer-reference/ossutil-overview/)、[OSS RAM 权限](https://help.aliyun.com/en/oss/user-guide/ram-policy/)。

### 8.2 配置备份程序

安装 `ossutil` 2.2 或更高版本，然后在项目目录执行：

```bash
cd /www/wwwroot/warehouse-management/warehouse-web
cp scripts/backup.env.example scripts/backup.env
nano scripts/backup.env
mkdir -p /www/backup/warehouse-management runtime
```

填写私有 Bucket、地域和目录，不要填写 AccessKey。先完成本机备份验证，再上传 OSS：

```bash
npm run backup:local
npm run backup:oss
cat runtime/backup-status.json
```

脚本使用 PostgreSQL 自定义格式备份，执行 `pg_restore --list` 验证，生成 SHA-256 校验文件，再上传 OSS。本机默认保留 7 天。

### 8.3 每日任务

通过 `command -v npm` 确认 npm 绝对路径，然后执行 `crontab -e`，每天清理运行期记录并备份：

```cron
30 2 * * * cd /www/wwwroot/warehouse-management/warehouse-web && /usr/bin/npm run db:cleanup-runtime >> /var/log/warehouse-maintenance.log 2>&1
40 2 * * * cd /www/wwwroot/warehouse-management/warehouse-web && /usr/bin/npm run backup:oss >> /var/log/warehouse-backup.log 2>&1
```

如果 `npm` 不在 `/usr/bin/npm`，替换为实际路径。系统维护页会显示最近一次备份状态。

### 8.4 恢复演练

不要直接覆盖生产数据库。下载一份备份并恢复到临时数据库：

```bash
sha256sum -c warehouse_YYYYMMDD_HHMMSS.dump.sha256
createdb -h 127.0.0.1 -U warehouse_app warehouse_restore_test
pg_restore -h 127.0.0.1 -U warehouse_app -d warehouse_restore_test --no-owner --no-privileges warehouse_YYYYMMDD_HHMMSS.dump
psql -h 127.0.0.1 -U warehouse_app -d warehouse_restore_test -c 'SELECT COUNT(*) FROM warehouse_stocks;'
psql -h 127.0.0.1 -U warehouse_app -d warehouse_restore_test -c 'SELECT COUNT(*) FROM inventory_items;'
dropdb -h 127.0.0.1 -U warehouse_app warehouse_restore_test
```

正式使用前至少成功完成一次恢复演练。

## 9. 健康检查

服务器更新后执行：

```bash
curl -i http://127.0.0.1:3000/api/health
```

HTTP `200` 且 `status`、`database` 均为 `ok` 才表示应用和数据库正常。HTTP `503` 表示数据库不可用。页面左下角显示 Web/API 版本，系统维护页显示完整运行和备份状态。

## 10. 上线检查

上线后检查：

1. 只能通过 `80/443` 访问网站。
2. 公网不能访问 `3000` 和 `5432`。
3. 三类账号权限正确。
4. 入库、出库、销售退回、库存查询和单据导出正常。
5. 网页端数据重置入口仅超级管理员可执行，且必须输入确认文字。
6. 备份任务已启用，并能生成备份文件。
7. `/api/health` 返回 200，页面显示的 Web/API 版本与本次发布一致。
8. OSS Bucket 保持私有，已完成一次临时数据库恢复演练。
