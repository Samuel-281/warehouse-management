# 本地数据库启动说明

## 1. 说明

本项目正式数据层使用 PostgreSQL + Prisma。当前基础资料、入库、出库、销售退回、库存查询和条码流水已经接入本地 PostgreSQL。

## 2. 准备 `.env`

在 `warehouse-web/` 目录下复制环境变量示例：

```bash
cp .env.example .env
```

默认连接串为：

```text
postgresql://warehouse:warehouse@localhost:5432/warehouse_management?schema=public
```

## 3. 启动 PostgreSQL

如果本机已安装 Docker，可在 `warehouse-web/` 目录运行：

```bash
docker compose up -d
```

这会启动一个本地 PostgreSQL：

| 项目 | 值 |
| --- | --- |
| 数据库 | `warehouse_management` |
| 用户名 | `warehouse` |
| 密码 | `warehouse` |
| 端口 | `5432` |

如果本机不用 Docker，也可以自行安装 PostgreSQL，并创建同名数据库和用户。

## 4. 应用迁移

在 `warehouse-web/` 目录运行：

```bash
npm run db:migrate
```

该命令会读取 `prisma/migrations/202605290001_initial_schema/migration.sql`，创建第一版业务表结构。

## 5. 写入演示数据

迁移完成后运行：

```bash
npm run db:seed
```

演示数据与当前页面原型一致，包括货物、仓库、库位、销售人员、终端店铺、单件条码库存和库存流水。

## 6. 重置演示数据库

测试过程中如果录入了很多临时数据，可以在 `warehouse-web/` 目录运行：

```bash
npm run db:reset-demo
```

命令启动后必须输入：

```text
确定重置
```

输入完全一致后才会继续执行。该命令会先清空本地 PostgreSQL 里的演示业务数据，再重新写入 `prisma/seed.sql` 中的初始演示数据。它只适合本地开发测试使用，不应在正式生产数据库上运行。

正式版可以保留类似“清空并重建演示/测试数据”的管理能力，但必须满足以下约束：

- 仅超级管理员角色可见、可执行。
- 执行前必须进行二次确认，建议输入指定确认文字。
- 执行前应提示影响范围，并建议确认最近一次数据库备份。
- 执行结果必须写入操作日志，记录操作人、时间、来源 IP、影响范围和结果。

## 7. 查看数据库

可以启动 Prisma Studio：

```bash
npm run db:studio
```

也可以用任意 PostgreSQL 客户端连接本地数据库。

## 8. 当前限制

当前仍是单机本地开发版本，尚未加入正式登录鉴权、权限控制、局域网部署配置和生产备份策略。
