# Netlify + Neon PostgreSQL 试运行部署说明

## 1. 目标

本方案用于把仓库货物管理系统部署成一个可外部访问的试运行版本：

- 网站和 Next.js API 部署到 Netlify。
- 数据库使用 Neon PostgreSQL。
- 不需要自建云服务器、Nginx、PM2 或 Docker。
- 不使用 NAS 数据库，不开放 PostgreSQL 公网端口。

这不是完整企业级生产运维方案，但适合 10 人左右先试运行。

## 2. 准备 Neon 数据库

1. 注册或登录 Neon。
2. 创建一个 PostgreSQL 项目。
3. 在 Neon 控制台复制 pooled connection string，格式类似：

```text
postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require
```

4. 建议在连接串末尾保留或补上：

```text
&schema=public
```

最终 `DATABASE_URL` 示例：

```text
postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require&schema=public
```

不要把真实连接串提交到 Git。

## 3. 初始化 Neon 数据库

在本机项目目录执行：

```bash
cd warehouse-web
```

临时把 Neon 连接串写入当前终端环境：

```bash
export DATABASE_URL="postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require&schema=public"
```

执行生产迁移：

```bash
npm run db:deploy
```

写入初始数据：

```bash
npm run db:seed
```

初始 seed 会创建三个演示账号：

| 账号 | 角色 |
| --- | --- |
| `super_admin` | 超级管理员 |
| `warehouse_admin` | 仓库管理员 |
| `inventory_viewer` | 只读查询人员 |

试运行/生产环境默认禁止继续使用 `demo123456` 登录。seed 后必须在 Neon SQL Editor 中修改初始密码：

```sql
UPDATE users SET "passwordHash" = '请换成强密码1' WHERE username = 'super_admin';
UPDATE users SET "passwordHash" = '请换成强密码2' WHERE username = 'warehouse_admin';
UPDATE users SET "passwordHash" = '请换成强密码3' WHERE username = 'inventory_viewer';
```

当前试运行版的密码字段仍沿用原型阶段的明文比较方式。正式长期使用前，应继续升级为真正的密码哈希存储。

## 4. 配置 Netlify

在 Netlify 中从 GitHub 导入仓库。

构建设置：

| 项目 | 值 |
| --- | --- |
| Base directory | `warehouse-web` |
| Build command | `npm run build` |
| Publish directory | `.next` |

仓库根目录已经提供 `netlify.toml`，正常情况下 Netlify 会自动读取这些配置。

在 Netlify Site Settings -> Environment variables 中添加：

| 变量名 | 说明 |
| --- | --- |
| `DATABASE_URL` | Neon pooled PostgreSQL 连接串 |
| `ALLOW_DEMO_DATABASE_RESET` | 保持 `false` 或不设置 |
| `ALLOW_DEMO_PASSWORD_LOGIN` | 保持 `false` 或不设置 |

不要在 Netlify 环境变量里使用本地 Docker 数据库连接串。

## 5. 部署和验证

建议先使用 Deploy Preview 验证，再发布 Production。

验证清单：

1. 能打开 Netlify 预览地址。
2. 三个账号使用修改后的密码能登录。
3. 只读查询人员只看到首页、单据查询、库存查询。
4. 仓库管理员可以入库、出库、销售退回和维护基础资料。
5. 超级管理员可以进入系统维护。
6. 线上点击重置演示数据库应被阻止，并显示禁用提示。
7. 新增一条入库记录后刷新页面，数据仍然存在。
8. 单据查询和库存查询能看到新增数据。

## 6. 更新和回滚

更新流程：

1. 本地完成修改并提交到 Git。
2. 推送到 GitHub。
3. Netlify 自动构建 Deploy Preview。
4. 验证无误后发布到 Production。

回滚流程：

1. 进入 Netlify Deploys。
2. 找到上一个可用版本。
3. 点击 Publish deploy。

数据库结构变更需要先执行迁移：

```bash
cd warehouse-web
export DATABASE_URL="Neon 连接串"
npm run db:deploy
```

## 7. 当前限制

- 本方案不使用 NAS 数据库。
- 本方案不处理 PDA 业务闭环。
- 本方案不配置备案、ECS、Nginx、PM2 或 Docker 生产服务。
- 当前试运行版仍需要后续补真正密码哈希、登录失败限制和更完整的备份恢复演练。
