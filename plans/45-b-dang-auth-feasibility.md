# 45 · B 档鉴权可行性结论(回应 44 号 §5.2 / §5.5 / §8)

> 编制日期:2026-09-29 · 编制人:架构师 · 阶段:**只读核实 + 可行性结论**,不写实现代码
> 上游:`plans/44-b-dang-prd.md`(B 档增量 PRD)、`plans/42-project-plan.md` §2.2
> 核实对象:`better-auth@1.7.3` 与 `@better-auth/core@1.7.3` 的**实际安装产物**(`.pnpm/` 下的 dist 与 src),不是文档记忆

---

## 0. 结论表

| # | 44 号的疑问 | 结论 | 对工期的影响 |
|---|---|---|---|
| 1 | 支付宝网关 / 微信 GET-query token 端点,`genericOAuth` 能否直接承接? | **能,不需要自建适配路由**。插件原生提供 `getToken` / `getUserInfo` 两个接管点 | **省回 PRD 预留的 0.5~1 天** |
| 2 | 同意中间页(回调后重定向 + 短期票据 + 延迟建号)是否可行? | **可行**,但**不要做短期票据**:用 better-auth 自带的 `newUserCallbackURL` + 一道服务端同意门 + 取消即删号 | 与 PRD 估时持平,实现更简单 |
| 3 | 加一个 provider 要改 ≥6 处 | 确认,**且还要再补 4 处**(其中 2 处漏了会静默失败) | 见 §3 |

---

## 1. 厂商端点形态:直接承接,不建适配路由

### 1.1 证据(`better-auth/dist/plugins/generic-oauth/`)

| 能力 | 位置 | 原文要点 |
|---|---|---|
| `getToken` | `types.d.mts` + `index.mjs:201` | "Custom function to exchange authorization code for tokens… **useful for providers with non-standard token endpoints**";实现:`if (c.getToken) return …await c.getToken(data)` —— **完全替换**默认换取 |
| `getUserInfo` | `index.mjs:227` | `c.getUserInfo ? await c.getUserInfo(oauthTokens) : await fetchUserInfo(...)` —— 同样完全替换 |
| `accountSubject` | `index.mjs:140-142` | 自定义"稳定主体"解析器,**比 `mapProfileToUser` 更早、且专管账号身份** |
| `tokenUrl` 可省 | `index.mjs:119` | `if (!authorizationUrl \|\| !tokenUrl && !c.getToken)` —— 有 `getToken` 就不必填 `tokenUrl` |
| `authorizationUrlParams` / `tokenUrlParams` | `types.d.mts` | 注入厂商私有参数 |

⇒ 支付宝的 RSA2 签名、响应验签写在 `getToken` / `getUserInfo` **内部**即可,仍然是真实驱动,不变成 mock。微信的 GET-query token 端点同理。**44 号 §5.2 的"架构提示"可以关闭。**

### 1.2 微信必须显式处理的三处硬约束

| 项 | 原因 | 配置 |
|---|---|---|
| **PKCE 必须关** | `index.mjs:181/206` 是 `c.pkce ?? true`,即**默认开**;微信不支持 PKCE,带上 `code_challenge` 会被拒 | `pkce: false` |
| **fragment `#wechat_redirect`** | 它是 URL fragment,**不能**走 `authorizationUrlParams`(会被塞进 query) | 直接写进 `authorizationUrl`:`https://open.weixin.qq.com/connect/qrconnect#wechat_redirect`。已核实 `create-authorization-url.mjs` 用 `new URL(...)` + `searchParams.set`,**fragment 会被保留** |
| **`scope` 是保留参数** | `create-authorization-url.mjs` 的 `RESERVED_AUTHORIZATION_PARAMS` 含 `scope`,`authorizationUrlParams.scope` 会被**静默丢弃** | 用顶层 `scopes: ["snsapi_login"]`;同理 `appid` 不在保留列表,可走 `authorizationUrlParams`(`client_id` 由框架强制写入,微信忽略它) |

### 1.3 W-3 匹配键(`unionid ?? openid`)

用 `accountSubject({ tokens, profile })` 实现,比在 `mapProfileToUser` 里绕更干净,也符合插件注释里"Better Auth never switches between fields at runtime"的设计意图。
PRD 要求的"`metadata.openid` 另存"需要额外落盘位置(`account` 表没有 metadata 列的现成写法)—— 建议降级为**记进 `account.scope` 之外的新列或直接放弃**,见 §5。

### 1.4 客户端无需注册 `genericOAuthClient`

44 号 §8 提到 `apps/web/src/libs/auth/client.ts` 没注册该插件。**这不是缺陷**:`genericOAuth` 的 `init` 把 provider 直接并入 `ctx.socialProviders`(源码注释:"Providers are used through the standard `signIn.social` and `callback/:id` core endpoints — **no plugin-specific endpoints needed**")。仓库里现有的 `custom` provider 就是靠 `authClient.signIn.social({ provider: "custom" })`(`social-auth.tsx:85` 起)工作的,没有任何客户端插件。
⇒ 建议把这条从 PRD 的风险清单里删掉,或改写成说明。

---

## 2. 同意中间页:可行,但不要做短期票据

### 2.1 关键发现:better-auth 自带"新用户专用重定向"

`sign-in.mjs` 的 body schema 支持 `callbackURL`、`newUserCallbackURL`、`errorCallbackURL`、`requestSignUp`;`callback.mjs` 末尾:

```
toRedirectTo = result.isRegister ? newUserURL || callbackURL : callbackURL
```

⇒ **新注册用户自动落到 `newUserURL`,老用户走 `callbackURL`**。这一分支是框架原生能力,零改造就能拿到。

### 2.2 推荐方案(四步)

1. 发起:`signIn.social({ provider: "wechat", callbackURL: "/dashboard", newUserCallbackURL: "/auth/consent" })`。
2. 回调:better-auth 完成换取、建 user + account、`setSessionCookie`,`isRegister=true` → 302 到 `/auth/consent`。
3. 中间页:展示将收集的信息与勾选框 → 提交到我们自己的端点 → 落 `user_consent`(source = `signup-wechat` / `signup-alipay` / `signup-phone`)→ 放行到 `/dashboard`。
4. **取消/关闭 → 用已启用的 `admin()` 插件删掉刚建的 user**(级联 account / consent / session)→ 回登录页,不留孤儿账号。

配套一道**服务端同意门**:在 `packages/auth/src/config.ts` 的 `hooks.before` 里,若会话存在但该 user 无任何 `user_consent` 行,则除 `/auth/consent` 与提交端点外一律重定向到中间页。这与文件里已有的 `/sign-up/email` + `legalConsentSchema` 门**完全同构**,是既有先例,不是新发明。

### 2.3 为什么"勾选后才建号"做不到,以及为什么这不影响合规

- 会话在 callback 里就已 `setSessionCookie`,账号也在 `handleOAuthUserInfo` 里建好 —— **延迟建号需要改 better-auth 内部的回调编排**。
- 唯一接近的开关是 `disableImplicitSignUp: true`,但那样 `handleOAuthUserInfo` 会走 `disableSignUp` 分支返回 `error: "signup disabled"`,回调随即 `redirectOnError` —— **profile 丢失**,还得自己把 profile 搬过去,反而更复杂。
- 合规要的是"**同意记录只在用户真的勾了的时候才写**"。本方案里 `user_consent` 一行仍然严格在勾选提交那一刻落库;未勾选的账号会被删除,**不会存在一个"已建号且被当作已同意"的状态**。
- 票据:**不需要自签短期票据**。会话 cookie 本身就是票据,且服务端随时可查 `user_consent` 表 —— 比自签票据更简单,也更难被篡改或重放。建议从 PRD §5.5 第 3 条里去掉"服务端签名票据"。

### 2.4 手机号通道

`phone-number` 插件确实存在(`dist/plugins/phone-number/`),选项含 `otpLength` / `expiresIn` / `allowedAttempts` / `signUpOnVerification` / `phoneNumberValidator` / `sendPasswordResetOTP` / `requireVerification`,与 PRD 一致。
建号时机建议**与第三方对齐**:让它建号,然后走同一个 `/auth/consent` 门(用 `signup-phone` 来源),这样三条通道共用一套同意逻辑与一道服务端门。

---

## 3. 登记点:确认 6 处,再补 4 处

PRD §8 第 4 条列的 6 处已逐条核实存在(`AuthProvider` 联合、`providers.list`(`service.ts:11`)、`getProviderName`/`getProviderIcon` 的 `.exhaustive()`、设置页 Section、`SocialAuthButtons`)。**另有 4 处**:

| # | 位置 | 为什么必须改 | 漏了会怎样 |
|---|---|---|---|
| 7 | `config.ts:417` `accountLinking` 需加 **`allowDifferentEmails: true`** | `callback.mjs` 的 link 分支:`userInfo.email !== link.email && allowDifferentEmails !== true` → `EMAIL_DOES_NOT_MATCH` 重定向。**微信/支付宝占位邮箱必然不等于用户真实邮箱**,不加就永远绑不上 | **静默失败**(绑定按钮点了没反应,跳 error 页) |
| 8 | `user.displayUsername` | `packages/db/src/schema/auth.ts:24` 是 `notNull().unique()`,与 `username` 并列。PRD §5.3 只提了 `username` | 建号时 NOT NULL 报错 |
| 9 | `packages/env` 的 zod schema + `turbo.json` 的 `globalEnv` | AGENTS.md 明确:未登记的环境变量会被 Turborepo 过滤成 `undefined` | **配了但不生效**,最难查的一类 |
| 10 | `phoneNumber` 插件的两列 + 迁移 | `user` 表现无 `phoneNumber` / `phoneNumberVerified`(已核实),需新 Drizzle 迁移 | 运行时缺列 |

### 3.1 第 7 项的安全影响(需 PM 拍板)

`allowDifferentEmails` 是**全局**开关,会同时放宽 google / github / linkedin 的邮箱匹配约束。
缓解:只把 `wechat` / `alipay` 加进 `trustedProviders`(PRD Q11 已定),并在 `hooks.before` 里对"绑定类"请求强制校验已有会话 —— 会话本身是 better-auth 从 state 里解析的,已登录这一前提不受该开关影响。
**替代方案**(若 PM 不想开全局开关):不走 better-auth 的 link 分支,由我们自己的端点在校验会话后直接写 `account` 行 —— 但要自己实现 account 写入与去重,工作量更大,不建议。

### 3.2 B2 必须排在 Python 迁移之前

PRD §8 第 5 条的判断成立:新增两列需要 Drizzle 迁移,而 `42-project-plan.md` §3.2 计划迁移后 Drizzle 停更。**同意该排序约束**,建议写进 42 号的硬约束清单。

---

## 4. 工期影响

| 项 | PRD 预估 | 本次核实后 |
|---|---|---|
| 适配路由(44 §5.2 / §8.3) | +0.5~1 天 | **0**(不需要建) |
| 同意中间页 | 含在 B1/B3 内 | 持平;但因不必自签票据,**略减** |
| 登记点 | 6 处 | 10 处(多出的多为机械改动,其中第 7 项是唯一需要设计判断的) |

---

## 5. 仍需实测或拍板的事项

1. **`#wechat_redirect` fragment 实测**:`new URL()` 保留 fragment 是规范行为且代码路径已确认,但 better-auth 后续若对 URL 做二次序列化仍可能丢。**建议实现期第一步就用单测断言授权 URL 字符串**,不要等到联调。
2. **微信 `client_id` 与 `appid` 并存**:框架强制写 `client_id`,微信预期 `appid`。理论上是"多余参数被忽略",但**需在单测里固定该假设**,并在 PRD 里标注为"未真实调用验证"。
3. **`metadata.openid` 另存**:`account` 表无现成 metadata 列。建议本期**放弃**,只存 `accountId = unionid ?? openid`;若必须留 openid,需新增列(即第 11 处登记点 + 又一条迁移)。
4. **`allowDifferentEmails` 全局放宽**是否接受(§3.1)。
5. **三条通道是否共用同一个 `/auth/consent` 页**(建议共用,来源靠 `ConsentSource` 区分)。
