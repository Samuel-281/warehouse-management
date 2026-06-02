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

种子数据与当前页面业务数据一致，包括货物、仓库、库位、销售人员、终端店铺、单件条码库存和库存流水。

本地开发默认账号如下，初始密码见 `warehouse-web/prisma/seed.sql`。正式环境执行 seed 后必须立即改为强密码：

| 账号 | 角色 | 说明 |
| --- | --- | --- |
| `super_admin` | 超级管理员 | 拥有全部系统权限，用于高危维护操作 |
| `warehouse_admin` | 仓库管理员 | 可维护基础资料，并执行入库、出库、销售退回 |
| `inventory_viewer` | 只读查询人员 | 仅可查看库存和条码流转 |

超级管理员登录后可进入“系统维护”，查看最近操作日志，并执行系统测试数据重置。网页端重置需要输入 `确定重置`，且只允许超级管理员执行。当前项目要求该入口在正式运行模式中常设开放，使用前应确认目标数据库。

当前开发版本按“每个仓库只使用一个默认库位”处理库存归属。系统内部仍保留库位字段用于后续扩展，但电脑端业务页面不要求选择具体库位。

## 6. 重置系统测试数据

测试过程中如果录入了很多临时数据，可以在 `warehouse-web/` 目录运行：

```bash
npm run db:reset-demo
```

命令启动后必须输入：

```text
确定重置
```

输入完全一致后才会继续执行。该命令会先清空本地 PostgreSQL 里的测试业务数据，再重新写入 `prisma/seed.sql` 中的初始数据。它只适合本地开发测试使用，不应在正式生产数据库上运行。

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

## 8. 当前说明

当前本地开发环境已经具备登录鉴权、角色权限、数据库读写和网页端高危维护保护。生产部署、备份和反向代理请参考 `docs/aliyun-ecs-deployment.md`。
