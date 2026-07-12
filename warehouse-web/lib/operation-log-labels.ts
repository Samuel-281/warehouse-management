const actionLabels: Record<string, string> = {
  AUTH_LOGIN: "用户登录",
  AUTH_LOGOUT: "用户退出",
  USER_CREATE: "新增账号",
  USER_UPDATE: "修改账号",
  USER_CHANGE_PASSWORD: "修改个人密码",
  USER_RESET_PASSWORD: "重置账号密码",
  MASTER_GOODS_CREATE: "新增货物",
  MASTER_GOODS_UPDATE: "修改货物",
  MASTER_GOODS_DELETE: "删除货物",
  MASTER_WAREHOUSE_CREATE: "新增仓库",
  MASTER_WAREHOUSE_UPDATE: "修改仓库",
  MASTER_WAREHOUSE_DELETE: "删除仓库",
  MASTER_SALESPERSON_CREATE: "新增销售人员",
  MASTER_SALESPERSON_UPDATE: "修改销售人员",
  MASTER_SALESPERSON_DELETE: "删除销售人员",
  MASTER_TERMINAL_STORE_CREATE: "新增终端店铺",
  MASTER_TERMINAL_STORE_UPDATE: "修改终端店铺",
  MASTER_TERMINAL_STORE_DELETE: "删除终端店铺",
  MASTER_SORT_UPDATE: "调整基础资料排序",
  INBOUND_CREATE: "创建入库单",
  OUTBOUND_CREATE: "创建出库单",
  SALES_RETURN_CREATE: "创建销售退回单",
  ORDERS_VOID: "撤销业务单据",
  BARCODE_CORRECT: "更正条码",
  INVENTORY_ITEM_WRITE_OFF: "核销货物",
  INVENTORY_ITEM_DELETE: "删除错误条码档案",
  WAREHOUSE_STOCK_ADJUST: "人工修正库存",
  SYSTEM_CONSISTENCY_AUDIT: "检查数据一致性",
  SYSTEM_RESET_DEMO_DATABASE: "清空业务数据"
};

const detailKeyLabels: Record<string, string> = {
  quantity: "数量",
  barcodes: "条码数量",
  replay: "重复请求",
  lines: "货物行数",
  voided: "撤销单据数",
  reason: "原因",
  quantityChange: "库存变动",
  status: "状态",
  roles: "角色",
  username: "账号",
  newBarcode: "新条码",
  healthy: "检查结果",
  errors: "错误数",
  info: "历史提示",
  count: "数量"
};

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: "超级管理员",
  WAREHOUSE_ADMIN: "仓库管理员",
  INVENTORY_VIEWER: "只读查询人员"
};

export function formatOperationAction(action: string) {
  return actionLabels[action] ?? `系统操作（${action}）`;
}

export function formatOperationDetail(detail?: string) {
  if (!detail) return "-";
  if (detail === "Clear operational data from web maintenance page") return "通过系统维护页面清空业务数据";

  const segments = detail.split(";").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => !segment.includes("="))) return detail;

  return segments.map((segment) => {
    const separator = segment.indexOf("=");
    const key = segment.slice(0, separator);
    const value = segment.slice(separator + 1);
    return `${detailKeyLabels[key] ?? key}：${formatDetailValue(key, value)}`;
  }).join("；");
}

function formatDetailValue(key: string, value: string) {
  if (key === "healthy") return value === "true" ? "正常" : "发现异常";
  if (key === "replay") return value === "true" ? "是" : "否";
  if (key === "status") {
    if (value === "ENABLED" || value === "enabled") return "启用";
    if (value === "DISABLED" || value === "disabled") return "停用";
  }
  if (key === "roles") {
    return value.split(",").map((role) => roleLabels[role] ?? role).join("、");
  }
  return value || "未填写";
}
