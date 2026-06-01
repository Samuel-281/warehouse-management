# 仓库货物管理软件

这是一个面向两级仓库业务的货物管理软件项目。项目当前阶段已经完成需求梳理、使用说明书、PDF 文稿、电脑端业务系统和 PostgreSQL 数据库接入。

系统围绕“每件货物一个唯一条码”建立库存追踪能力，支持总仓、分仓、销售人员名下货物和单件条码流转查询。

## 当前状态

- 已完成需求文档和使用说明书。
- 已完成电脑端 Next.js 业务系统，覆盖入库、出库、销售退回、库存查询、单据查询和基础资料维护。
- 已接入 PostgreSQL + Prisma，支持本地数据库和后续 ECS 部署。
- 已完成角色登录、页面权限和 API 权限收口。
- 保留低保真 PDA 扫码入口草图，但 PDA 不作为 1.0 正式交付功能。
- 已初始化 Git 仓库，并发布到私有 GitHub 仓库。
- 当前正在准备 1.0 发布和阿里云 ECS 同机部署。

## 核心业务范围

第一阶段聚焦以下业务：

1. 厂家到货入库。
2. 终端店铺退换货入库。
3. 总仓和分仓之间挪仓。
4. 总仓或分仓销售出库。
5. 销售人员未销售完货物退回仓库。
6. 库存查询。
7. 单件条码库存流转查询。

暂不纳入第一阶段的能力包括审批、盘点、库存预警、成本核算、外部系统集成、RFID 和终端店铺级销售分配。

## 已确认业务规则

- 仓库层级只分为两级：总仓和分仓。
- 每件货物的条形码编号唯一且不可重复。
- 系统不负责生成条码，只负责录入、校验和追踪。
- 厂家到货可进入总仓或分仓。
- 终端店铺退换货入库必须登记生产日期。
- 保健酒默认保质期为生产日期三年后，白酒默认无保质期。
- 挪仓支持总仓和分仓之间互相流转，不需要接收方确认。
- 销售出库只分配到销售人员名下，不分配到具体终端店铺。
- 销售退回和终端店铺退换货是两个不同业务。
- 销售退回只把销售人员名下条码回流到仓库，不重新登记生产日期或保质期。

## 项目结构

```text
.
├── AGENTS.md
├── README.md
├── docs/
│   ├── warehouse-management-requirements.md
│   ├── warehouse-management-user-manual.md
│   └── warehouse-management-user-manual.pdf
├── scripts/
│   └── export_docx_to_pdf.applescript
└── warehouse-web/
    ├── app/
    ├── components/
    ├── lib/
    ├── scripts/
    ├── package.json
    └── package-lock.json
```

## 本地运行原型

```bash
cd warehouse-web
npm install
npm run dev
```

默认访问：

```text
http://127.0.0.1:3000
```

如果 3000 端口已被占用，Next.js 会提示或切换到其他端口，例如 `3001`。

## 文档入口

- 需求文档：`docs/warehouse-management-requirements.md`
- 使用说明书：`docs/warehouse-management-user-manual.md`
- PDF 文稿：`docs/warehouse-management-user-manual.pdf`
- 技术架构：`docs/technical-architecture.md`
- 数据库设计：`docs/database-schema.md`
- 本地数据库启动：`docs/local-database-setup.md`
- 阿里云 ECS 部署：`docs/aliyun-ecs-deployment.md`
- 1.0 发布检查：`docs/release-1.0-checklist.md`
- 1.0 发布说明：`docs/release-notes-1.0.md`
- 后续协作背景：`AGENTS.md`

## 下一阶段建议

1. 按 `docs/release-1.0-checklist.md` 完成发布前验证。
2. 按 `docs/aliyun-ecs-deployment.md` 部署到阿里云 ECS。
3. ECS 试运行稳定后，再根据实际 PDA 设备补齐扫码闭环。
4. 后续再规划盘点、库存预警、报表和外部系统集成。
