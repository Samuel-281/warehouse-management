# 终端签收自动同步部署说明

## 功能边界

终端签收同步只按唯一箱码补充扫码时间、扫码人、外部商品名称和收货单位。它不会增加或扣减仓库库存，也不会改变条码当前归属。

系统支持两种触发方式：

1. 每周一 00:00（Asia/Shanghai）自动同步上一周周一至周日的数据。
2. 管理员点击“立即同步”，同步最近一次成功截止时间至点击时刻的数据。

第三方按日期导出时可能包含边界日期的重复数据。系统使用箱码、扫码时间、扫码人、外部商品、单位和收货单位组成唯一指纹，重复记录会跳过，不会重复写入。

## 服务器配置

真实登录信息只允许写入服务器上的 `warehouse-web/.env`，不得写入源码、示例文件或 GitHub：

```dotenv
QINCE_TENANT_CODE="企业账号"
QINCE_USER_CODE="登录账号"
QINCE_PASSWORD="登录密码"
QINCE_EXPORT_TIMEOUT_MS="180000"
```

修改环境变量后重新构建并使用 `pm2 restart warehouse-web --update-env` 重启 Web 服务。系统页面显示“自动同步已配置”后，可先点击一次“立即同步”验证。

如果勤策要求验证码或触发登录保护，任务会记录失败但不会推进同步截止时间。管理员应先在勤策网页完成登录验证，再重新执行同步。

## 每周定时任务

先确认服务器时区：

```bash
timedatectl
sudo timedatectl set-timezone Asia/Shanghai
```

确认手工命令可正常完成：

```bash
cd /www/wwwroot/warehouse-management/warehouse-web
npm run terminal-receipts:sync-weekly
```

使用 `crontab -e` 增加每周一零点任务。若实际项目目录不同，请替换路径：

```cron
0 0 * * 1 cd /www/wwwroot/warehouse-management/warehouse-web && /usr/bin/npm run terminal-receipts:sync-weekly >> /var/log/warehouse-terminal-receipt-sync.log 2>&1
```

定时任务失败时返回非零状态，系统维护日志和终端签收页面都会保留失败原因。只有成功任务才会更新最近同步截止时间。

## 手工导入兜底

原有 Excel 预览和导入功能继续保留。当第三方登录、导出服务或网络异常时，可从勤策网页下载码明细后手工导入。同一批记录即使随后被自动同步再次获取，也会被唯一指纹识别并跳过。
