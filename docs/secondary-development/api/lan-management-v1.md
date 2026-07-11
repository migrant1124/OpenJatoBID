# Jato AI BID 局域网管理 API v1

状态：Draft（T10 骨架已实现，授权与统计字段在对应纵向切片中补齐）  
默认地址：`http://<管理端局域网 IP>:47821/api/v1`

## 通用约定

- 请求与响应均为 UTF-8 JSON。
- 成功响应统一为 `{ "data": ... }`。
- 失败响应统一为 `{ "error": { "code": "MACHINE_CODE", "message": "中文提示" } }`。
- 时间使用 ISO 8601 UTC 字符串；业务日期展示统一转换为北京时间。
- 客户端只向登录/申请页配置的局域网地址发送授权和埋点。
- 姓名、手机号和设备指纹只用于授权，不进入第三方 AI 请求。

## 健康检查

### `GET /api/v1/health`

响应 `200`：

```json
{
  "data": {
    "status": "ok",
    "apiVersion": "v1",
    "managementVersion": "1.0.0",
    "serverTime": "2026-07-10T00:00:00.000Z"
  }
}
```

## 授权接口

### `POST /api/v1/authorization/applications`

提交姓名、手机号、设备指纹、客户端 ID、平台和架构。成功返回申请 ID 与 `PENDING` 状态。

### `GET /api/v1/authorization/applications/:applicationId`

返回 `PENDING`、`APPROVED`、`REJECTED` 或 `DEVICE_LIMIT`。批准时同时返回签名授权。

### `POST /api/v1/authorization/login`

已授权员工使用姓名、手机号和当前设备登录。成功返回最新签名授权；身份或设备不匹配时返回统一授权错误。

### `POST /api/v1/authorization/verify`

定期复核签名授权。成功响应更新客户端最近成功校验时间；网络错误不得被视为成功。

## 运维统计

### `POST /api/v1/analytics/events`

批量接收不含业务涉密内容的事件。每条事件必须携带客户端生成的 `eventId`，管理端按该字段幂等去重。

## 状态码

| HTTP | code | 含义 |
| --- | --- | --- |
| 200/201 | — | 请求成功 |
| 400 | `INVALID_JSON` | JSON 无法解析 |
| 404 | `NOT_FOUND` | 接口或资源不存在 |
| 409 | `APPLICATION_CONFLICT` | 相同设备存在待审批申请 |
| 409 | `EMPLOYEE_DEVICE_LIMIT` | 员工已有 3 台有效设备 |
| 422 | `VALIDATION_ERROR` | 输入字段不符合要求 |
| 500 | `INTERNAL_ERROR` | 管理端内部处理失败，不返回堆栈或数据库细节 |
