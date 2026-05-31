# 仓库货物管理系统公网部署方案

## 目标

将当前仓库货物管理系统从本地开发环境推进到可公网访问、可持续维护、可备份恢复的正式部署环境。

当前建议优先完成电脑端正式 UI 和交互，再进入部署工程化。PDA 业务先暂停。

## 推荐架构

### 方案 A：阿里云 ECS + 阿里云 RDS PostgreSQL

这是正式上线的推荐方案。

结构：

1. 前端和 Next.js 服务部署在阿里云 ECS。
2. 数据库使用阿里云 RDS PostgreSQL。
3. ECS 通过内网连接 RDS。
4. 外部用户通过域名和 HTTPS 访问 ECS。
5. RDS 不开放公网访问，仅允许 ECS 内网访问。

优点：

1. 备份、恢复、高可用和监控能力更完整。
2. 数据库不直接暴露公网，安全边界清晰。
3. 后续做企业微信、短信、对象存储、日志等扩展更顺。
4. 公网部署、备案、证书、域名解析都在同一云厂商内处理，运维成本低。

需要注意：

1. 如果服务器位于中国内地并使用域名对外提供网站服务，需要完成 ICP 备案。
2. 正式网站还需要按要求完成公安联网备案，并在页面显著位置展示备案号。
3. HTTPS 证书、ECS 安全组、RDS 白名单、自动备份策略都要纳入上线清单。

参考：

1. 阿里云 ICP 备案说明：https://help.aliyun.com/zh/icp-filing/basic-icp-service/product-overview/what-is-an-icp-filing
2. 阿里云 ICP 备案流程：https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/
3. 阿里云网站备案全流程：https://help.aliyun.com/zh/dws/filing/
4. 阿里云 RDS PostgreSQL：https://help.aliyun.com/zh/rds/
5. RDS PostgreSQL 自动备份：https://help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/back-up-an-apsaradb-rds-for-postgresql-instance
6. RDS PostgreSQL SSL 链路加密：https://help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/configure-ssl-encryption-for-an-apsaradb-rds-for-postgresql-instance

## 备选架构

### 方案 B：阿里云 ECS + NAS 自建 PostgreSQL

结构：

1. Next.js 服务部署在阿里云 ECS。
2. PostgreSQL 部署在 UGREEN NAS 的 Docker 中。
3. ECS 通过 VPN、内网穿透或固定公网 IP 访问 NAS 数据库。

不建议作为正式生产首选。

主要风险：

1. 家庭或办公室宽带公网 IP、端口开放、网络稳定性都可能不稳定。
2. 如果直接暴露 PostgreSQL 端口到公网，风险很高。
3. 跨公网访问数据库会带来延迟和断线问题。
4. NAS 的备份、恢复、磁盘健康、UPS 供电、数据库监控都需要自己承担。

如果坚持使用该方案，最低要求：

1. 不直接暴露 PostgreSQL 5432 到公网。
2. 使用 WireGuard、Tailscale、ZeroTier 或云企业网/VPN 建立私有通道。
3. PostgreSQL 强密码、最小权限账号、SSL 连接。
4. NAS 做自动快照，数据库做每日逻辑备份。
5. 定期做恢复演练。
6. ECS 只允许通过安全组访问 Web 端口，不允许数据库端口公网开放。

### 方案 C：NAS 同时部署网站和数据库

适合局域网或 VPN 内部访问，不建议直接公网开放。

适用场景：

1. 只给公司内部人员使用。
2. 通过 VPN 访问，不暴露公网 Web 服务。
3. 初期低成本试运行。

不适合作为正式公网服务的原因：

1. 宽带、动态 IP、端口映射、证书续期、攻击防护都要自己维护。
2. 数据库和应用在同一家庭/办公室网络中，故障域过于集中。
3. 备案、域名解析和公网安全配置更复杂。

## 正式上线前必须补齐

当前系统已经具备核心业务原型和数据库接入，但还不能直接视为生产系统。上线前至少需要完成：

1. 密码安全：当前演示密码仍偏原型，需要改为强密码策略和安全哈希。
2. 登录保护：失败次数限制、会话过期策略、退出全部设备能力。
3. 权限细化：超级管理员、仓库管理员、只读查询人员的页面和 API 权限双重校验。
4. 环境变量：拆分开发、测试、生产 `.env`，生产密钥不得提交 Git。
5. 数据库迁移：使用 Prisma migration 管理生产表结构。
6. 备份恢复：每日自动备份，保留周期，恢复演练。
7. HTTPS：全站启用 HTTPS，HTTP 自动跳转。
8. 日志审计：业务操作日志、登录日志、异常日志。
9. 错误处理：页面级错误提示、接口错误格式统一。
10. 部署脚本：Dockerfile、docker-compose 或 ECS systemd 部署脚本。
11. 备案信息：如果部署在中国内地服务器，按要求展示 ICP 和公安备案号。

## 推荐落地顺序

1. 电脑端 UI 和交互正式化。
2. 拆分生产环境配置。
3. 增加 Dockerfile 和生产启动方式。
4. 完成密码哈希和登录保护。
5. 准备阿里云 ECS + RDS PostgreSQL 测试环境。
6. 配置域名、HTTPS、备案。
7. 导入演示数据并完成试运行。
8. 再决定 PDA 设备到货后的移动端闭环。
