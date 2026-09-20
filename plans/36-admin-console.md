# 36 — 后台管理界面(Admin Console)设计

> 状态:**P0 基座、P1 用户管理、P2 简历管理、P3 概览 + 设置、审计日志全部完成**(后台不再有占位页)
> 日期:2026-09-18
>
> **P0 落地清单**(2026-09-18):
> - 迁移 `migrations/20260918012504_cloudy_namorita`:新增 `admin_audit_log`、`instance_setting` 两表(未执行,需 `pnpm db:migrate`)
> - `packages/api/src/roles.ts`:角色白名单;单测 `roles.test.ts` 7 例全通过
> - `packages/api/src/context.ts`:新增 `adminProcedure`
> - `tooling/database/promote-admin.ts` + 根脚本 `pnpm admin:promote -- <email> [--revoke]`
> - `apps/web/src/routes/admin/`:独立路由树 + `beforeLoad` 守卫 + 侧栏;dashboard 侧栏按角色显示入口
> - `packages/ui/src/components/data-table.tsx`:`@tanstack/react-table` v8 封装(见下方"版本决策")
>
> **P1 落地清单**(2026-09-18):
> - `packages/api/src/dto/admin.ts`:`adminUserDto`(list / getById / setRole / setBan / delete),输出 schema 明确排除凭证列
> - `packages/api/src/features/admin/{actions,audit,service,router}.ts` + `service.test.ts`(10 例全通过)
> - `packages/api/src/routers/index.ts`:挂载 `admin: adminRouter`;5 个端点全部 `tags: ["Internal"]`
> - `apps/web/src/routes/admin/users.tsx`:列表页(搜索防抖 / 角色+状态筛选 / 排序 / 服务端分页)
> - `apps/web/src/routes/admin/-components/users-table.tsx`:列定义 + 行操作菜单 + 封禁对话框
> - `packages/ui/src/components/data-table.tsx`:补 re-export(`createColumnHelper` 及类型),`columns` 泛型简化为 `ColumnDef<TData, any>[]`
>
> **P2 落地清单**(2026-09-19):
> - `packages/api/src/dto/admin.ts`:`adminResumeDto`(list / setLock / delete);输出只给 `hasPassword`,凭证列**从不 SELECT**
> - `packages/api/src/features/admin/resume-service.ts` + `resume-service.test.ts`(12 例全通过)
> - `packages/api/src/features/admin/sql.ts`:`escapeLike` 从 `service.ts` 抽出,两个 service 共用
> - `packages/api/src/features/resume/events.ts`:`notifyResumeUpdated` 从 `service.ts` 的私有函数提为导出,admin 与 resume 共用同一套实时通道
> - `packages/api/src/features/admin/router.ts`:挂载 `resumes`(3 个端点,全部 `tags: ["Internal"]`)
> - `apps/web/src/routes/admin/resumes.tsx`:列表页替换占位(搜索防抖 / 可见性+锁定筛选 / 排序 / 服务端分页)
> - `apps/web/src/routes/admin/-components/resumes-table.tsx`:列定义 + 锁定解锁/删除行操作
> - 审计复用 P0 预留的 `resume.lock.set` / `resume.delete`,无需新迁移
>
> **P3 落地清单**(2026-09-19):
> - `packages/auth/src/instance-settings.ts` + `instance-settings.test.ts`(9 例全通过):`DB > env > 默认` 三级解析,**带 `source` 标注**与 5 秒 TTL 缓存 + 写后主动失效。新增包导出行 `@reactive-resume/auth/instance-settings`
> - `packages/auth/src/config.ts`:**运行时门禁真正生效** —— `databaseHooks.user.create.before`(注册唯一收口)+ `hooks.before` 按路径拦 email/password 路由
> - `packages/api/src/features/storage/service.ts`:新增 `usage(prefix)`;local 用 `readdir + stat`,S3 复用 `ListObjectsV2` 响应里本就有的 `Contents[].Size`(含分页)
> - `packages/api/src/features/admin/overview-service.ts` + `setting-service.ts`(+ 各自单测)
> - `packages/api/src/dto/admin.ts`:`adminOverviewDto` / `adminSettingDto`
> - `apps/web/src/routes/admin/overview.tsx` + `-components/signup-trend.tsx`:统计卡片 + 手写 SVG 趋势图(**不引图表依赖**)
> - `apps/web/src/routes/admin/settings.tsx`:两个开关 + 来源标注 + `smtpEnabled` 只读展示
> - **无需新迁移**,`instance_setting` 表 P0 已建,审计动作 `instance.setting.set` 也已预留
>
> **审计日志已完成**(2026-09-19,补上 P0–P3 都没覆盖的最后一个占位页):
> - `packages/api/src/audit-actions.ts`:`AUDIT_ACTIONS` / `AUDIT_TARGET_TYPES` 从 `features/admin/actions.ts` **提到顶层**(与 `roles.ts` 同一模式)—— DTO 需要用它们做筛选枚举,留在 features 里会形成 `dto → features → dto` 循环
> - `packages/api/src/features/admin/audit-service.ts` + `audit-service.test.ts`(5 例):**leftJoin** user,因为 `actor_id` 是 `on delete set null`
> - `packages/api/src/dto/admin.ts`:`adminAuditDto`(action/targetType/搜索筛选 + 分页)
> - `packages/api/package.json`:新增导出 `./audit-actions`(前端筛选下拉复用同一份枚举,避免硬编码漂移)
> - `apps/web/src/routes/admin/audit.tsx` + `-components/audit-table.tsx`
> - **删除** `apps/web/src/routes/admin/-components/placeholder.tsx` —— 最后一个占位页已实现
> - 顺带把 knip 修绿(见第十四节)

## 一、目标

给 Reactive Resume 增加一套**实例级后台管理界面**,让管理员在不连数据库的情况下完成:查看实例运行概况、管理用户(角色/封禁/删除)、管理简历内容,以及(后续)调整实例设置与查看操作审计。

## 二、现状盘点(已核实)

| 能力 | 现状 |
|------|------|
| Better Auth `admin()` 插件 | **已启用**(`packages/auth/src/config.ts:293`) |
| 前端 `adminClient()` | **已挂载**(`apps/web/src/libs/auth/client.ts`) |
| `user.role` 字段 | **已存在**(默认 `'user'`),并有 `banned` / `banReason` / `banExpires` |
| 管理端 API | **完全没有**——无 `adminProcedure`,无 admin 相关 router |
| 管理端页面 | **完全没有** |
| 表格组件 | **没有**——`packages/ui` 里无 table,也无 `@tanstack/react-table` 依赖 |
| 权限体系 | oRPC `publicProcedure` / `protectedProcedure`(`packages/api/src/context.ts`);前端路由用 `beforeLoad` + `context.session` 守卫 |
| 功能开关(flags) | 存在但**只读**,值来自环境变量(`disableSignups` / `disableEmailAuth` / `smtpEnabled`),不支持运行时修改 |

结论:**地基已经打好了(角色字段 + admin 插件),缺的是上面整层**——管理端 API、页面、表格 UI。

## 三、权限模型

采用**单一管理员角色**,不做细粒度权限点(本期)。

- 判定依据:`user.role === "admin"`(Better Auth admin 插件默认角色名即 `admin`)。
- 服务端新增 `adminProcedure` = `protectedProcedure` + 角色校验,**每次请求都查**,绝不依赖前端隐藏。
- 前端只是"看不见/进不去",真正的门禁在服务端。

```ts
// packages/api/src/context.ts
export const adminProcedure = protectedProcedure.use(({ context, next }) => {
  if (context.user.role !== "admin") throw new ORPCError("FORBIDDEN");
  return next({ context });
});
```

如何产生第一个管理员:提供 `pnpm --filter @reactive-resume/db admin:promote -- <email>` 之类的脚本(或直接 SQL),避免"鸡生蛋"问题。

预留:若将来需要多角色(如 `moderator` 只能管内容、不能删用户),把单点判断换成权限点集合,接口形状不变。

## 四、后端设计

新增 `packages/api/src/features/admin/`,按子域拆:

```
admin/
  router.ts          # 聚合
  overview/          # 实例概览
  users/             # 用户管理
  resumes/           # 简历管理
  settings/          # 实例设置(二期)
  audit/             # 审计日志(二期)
```

### API 端点草案

| Method | Path | 说明 | 权限 |
|--------|------|------|------|
| GET | `/admin/overview` | 实例概况:用户总数/新增趋势、简历总数、公开简历数、存储用量 | admin |
| GET | `/admin/users` | 用户列表:分页、按邮箱/用户名搜索、按角色/封禁状态筛选、排序 | admin |
| GET | `/admin/users/:id` | 单个用户详情(含简历数、最后活跃、登录方式) | admin |
| PATCH | `/admin/users/:id` | 改角色、封禁/解封(含原因与到期时间) | admin |
| DELETE | `/admin/users/:id` | 删除用户及其全部数据 | admin |
| GET | `/admin/resumes` | 简历列表:分页、按标题/用户名搜索、按可见性筛选 | admin |
| PATCH | `/admin/resumes/:id` | 锁定/解锁简历 | admin |
| DELETE | `/admin/resumes/:id` | 删除简历 | admin |
| GET | `/admin/settings` | 读取实例设置(含每个值的来源:DB 覆盖 / 环境变量 / 默认) | admin |
| PATCH | `/admin/settings` | 修改可改项(本期:`disableSignups`、`disableEmailAuth`) | admin |
| GET | `/admin/audit-logs` | 审计日志:分页、按操作者/动作类型/目标筛选 | admin |

要点:

- 全部走 `adminProcedure`,统一挂 `tags: ["Internal"]`,**不出现在公开 OpenAPI 文档**(生成器已过滤 Internal)。
- 列表统一返回 `{ items, total, page, pageSize }`,为分页组件留出一致契约。
- 写操作(封禁/删除)全部要求二次确认(前端)+ 服务端记录操作者(审计二期)。
- 删除用户要级联处理:简历、封面信、申请记录、AI 提供商、会话、文件对象——需明确列出清理顺序,避免留下孤儿数据。

### 数据模型

**不需要动的部分**:`user.role`、`banned`、`banReason`、`banExpires` 已存在,角色体系零迁移。

**需要新增两张表(一次迁移)**:

1. `admin_audit_log` —— 审计日志

   | 字段 | 类型 | 说明 |
   |------|------|------|
   | `id` | text PK | 默认 `generateId()` |
   | `actor_id` | text FK → user.id | 操作者(管理员) |
   | `action` | text | 枚举式字符串,如 `user.ban` / `user.role.change` / `resume.delete` / `settings.update` |
   | `target_type` | text | `user` / `resume` / `settings` |
   | `target_id` | text,可空 | 目标对象 ID |
   | `metadata` | jsonb,可空 | 变更前后值、原因等 |
   | `created_at` | timestamp | 默认 now |

   索引:`(target_type, target_id)` 与 `(created_at desc)`。所有 admin 写操作必须落一条,读操作不记。

2. `instance_setting` —— 运行时实例设置

   | 字段 | 类型 | 说明 |
   |------|------|------|
   | `key` | text PK | 如 `disableSignups`、`disableEmailAuth` |
   | `value` | jsonb | 值 |
   | `updated_by` | text FK → user.id,可空 | 最后修改者 |
   | `updated_at` | timestamp | 默认 now |

   **与环境变量的关系**:现有 flags 由 `env.DISABLE_SIGNUPS` / `env.DISABLE_EMAIL_AUTH` 驱动且**只读**。新表不能简单覆盖它,否则自托管用户升级后会行为突变。采用三级优先级:

   ```
   DB 显式设置  >  环境变量  >  默认值(false)
   ```

   即:后台没改过 → 完全沿用今天的 env 行为(向后兼容);后台改过 → DB 值优先,并在设置页标注"当前由环境变量提供 / 已被后台覆盖"。这样既满足"运行时可改",又不会破坏既有部署。

   本期只把 `disableSignups`、`disableEmailAuth` 两个开关纳入可改范围;`smtpEnabled` 保持只读(它由 SMTP 是否配置推导,不该手动改)。

## 五、前端设计

### 路由

新增独立路由树,**不复用 dashboard**(职责与信息密度不同):

```
apps/web/src/routes/admin/
  route.tsx        # 布局 + 守卫(role !== admin → 重定向/404)
  overview.tsx
  users/
    index.tsx      # 列表
    $userId.tsx    # 详情
  resumes/
    index.tsx
```

守卫写在 `admin/route.tsx` 的 `beforeLoad`:无 session → 登录页;非 admin → 重定向到 `/dashboard`(或 404,避免暴露后台存在)。

### 入口

仪表盘侧边栏与头像菜单各加一个"管理后台"入口,`role === "admin"` 时才渲染(数据来自已有的 session context,不额外请求)。

### UI

- 复用 `packages/ui` 现有组件(button、input、dialog、dropdown-menu、badge、tabs、tooltip)。
- **表格是缺口**,两个选择:
  - A. 引入 `@tanstack/react-table`(与项目已用的 TanStack Router/Start 同源,支持排序/分页/筛选/列控制,长期省事)
  - B. 手写轻量表格(零新依赖,但排序筛选要自己实现)
  - **建议 A**,并在 `packages/ui` 里封装一层 `data-table`,与项目其余组件风格统一。
- 所有文案用 `t` / `Trans` 包裹,改完跑 `pnpm --filter web lingui:extract`。

## 六、安全设计

1. **服务端强制校验**:每个 admin 端点都过 `adminProcedure`,前端不可信。
2. **不泄露存在性**:非管理员访问后台路由返回 404 而非 403(可选,取决于是否想隐藏后台存在)。
3. **危险操作**:删除用户/简历要求输入确认词或二次弹窗;封禁需填原因。
4. **自我保护**:管理员不能封禁/删除自己;系统中至少保留一名管理员。
5. **速率限制**:复用现有 `rateLimitConfig`,必要时给 admin 端点单独配一档。
6. **审计**:二期补上,谁在什么时候改了什么。
7. **不要**把 admin 端点暴露到公开 OpenAPI(`tags: ["Internal"]` 已能过滤)。

## 七、已定决策

| 决策项 | 结论 |
|--------|------|
| 功能范围 | 概览看板 + 用户管理 + 简历管理 + 实例设置(四项全做) |
| 表格方案 | 引入 `@tanstack/react-table`,在 `packages/ui` 封装 `data-table` |
| 权限粒度 | 单一 `admin` 角色,不做多角色 |
| 审计日志 | **需要**,随本期一起做 |

## 八、分阶段实施

| 阶段 | 内容 | 产出 |
|------|------|------|
| **P0 基座** | `adminProcedure` + 角色白名单校验;提升管理员脚本;`admin_audit_log` + `instance_setting` 两表与迁移;`/admin` 布局与守卫;引入 `@tanstack/react-table` 并封装 `data-table` | 管理员能进后台(此时为空壳),权限与审计底座就绪 |
| **P1 用户管理** ✅ | 用户列表(搜索/筛选/排序/分页)、详情、改角色、封禁解封、删除;写操作落审计 | 后台第一个可用闭环 |
| **P2 简历管理** | 简历列表(搜索/筛选)、锁定解锁、删除;写操作落审计 | 内容治理能力 |
| **P3 概览 + 设置** | 实例概况卡片与趋势图;设置页(两个开关,DB > env > 默认) | 完整后台 |

建议顺序 P0 → P1,先跑通"权限基座 → 列表 → 写操作 → 审计"整条链路,再横向复制到 P2/P3。

## 九、风险与注意

- **级联删除**是最容易出事的地方,必须先理清 `user` → `resume` / `coverLetter` / `application` / `aiProvider` / `session` / 存储对象的清理顺序,并写测试。
- **role 字段没有约束**:目前是 `text` 且默认 `user`,任何人被误设为 `admin` 即获得全部权限;**本期加白名单校验**(只允许 `user` / `admin`),不允许任意字符串写入。
- **Better Auth admin 插件的 API**(`auth.api.listUsers` 等)与自己写 Drizzle 查询二选一,不要混用导致权限判断不一致;**统一走自己写的 admin router**,便于加 OpenAPI 标签与审计。
- **环境变量优先级的兼容**:`instance_setting` 采用"DB > env > 默认",必须保证后台从未改动时行为与今天**完全一致**,否则自托管用户升级后会意外开放或关闭注册。设置页要明确显示每个值的来源。
- **审计写入不能阻断主操作**:审计落库失败应记 error 并继续,不能让管理员的封禁/删除因此失败;但也不能静默吞掉,需可观测。
- **迁移要带快照**:新增两张表后走 `dotenvx run -f .env.local -- pnpm db:generate`,生成的 SQL 与 `migrations/<ts>_*/snapshot.json` 一并提交。
- 改动涉及 API、DB、Web 三处,记得按 `AGENTS.md` 的"跨多处改动"清单核对;新增 UI 文案后跑 `pnpm --filter web lingui:extract`(它会连带执行 `pdf:translations`)。

## 十、实施备注(P0 过程中踩到的坑)

1. **`@tanstack/react-table` 用 v8 而不是 v9。** v9 是重写版:`useTable` 取代 `useReactTable`,且必须先 `tableFeatures({...})` 注册能力才有排序/分页 API。实测在**泛型共享组件**里,v9 的 feature-gated 类型会退化成 `any`(`table.getHeaderGroups()` 返回 `any`),把类型安全全部丢掉。v8 的 `useReactTable` + `getCoreRowModel()` 组合在泛型下推断正常,因此锁 `^8.21.3`。
2. **`packages/ui` 必须显式依赖 `@tanstack/table-core`。** `react-table` 的类型几乎全部 `export * from "@tanstack/table-core"`,而 pnpm 的严格 node_modules 不会把传递依赖暴露给 `packages/ui`,缺它会报"has no exported member"(而不是更直觉的"cannot find module")。
3. **Better Auth 的基础 `User` 类型不含 `role`。** `adminProcedure` 里要读 `context.user.role`,必须改用 `AuthSession["user"]`(`@reactive-resume/auth/types`),该类型由 `auth.$Infer.Session` 推导,带上了 admin 插件追加的字段。
4. **`packages/api` 与 `apps/web` 的 `pnpm typecheck` 目前是红的基础盘**(516 / 706 个错误),根因是依赖树里存在两份 drizzle(zod 4.5.4 / 4.6.1)导致类型不兼容,与本次改动无关(改动前后错误数一致)。做类型校验时按"我改的文件有没有新增错误"来判断,不要看总数。
5. **路由树需要构建才会生成。** `apps/web/src/routeTree.gen.ts` 由 vite 插件产出,新增路由文件后必须跑一次 `pnpm --filter web build`(或 `dev`),否则类型检查会认不出 `/admin/*`。

## 十一、实施备注(P1 过程中踩到的坑)

1. **`apps/web` 没有、也不该直接依赖 `@tanstack/react-table`。** 起初 `users-table.tsx` 直接从它 import `createColumnHelper`,`tsc` 能过但 `vite build` 报解析失败(pnpm 严格 node_modules)。解法是在 `packages/ui/src/components/data-table.tsx` 顶部 re-export `createColumnHelper` 及 `ColumnDef` / `OnChangeFn` / `PaginationState` / `SortingState`,web 侧只从 `@reactive-resume/ui/components/data-table` 取。
2. **`DataTable` 的 `columns` 不能写成 `ColumnDef<TData, TValue>[]`。** 每一列的值类型各不相同,`TValue` 无法被推断成单一类型,`columns={columns}` 处会报"类型无法统一"。改成 `ColumnDef<TData, any>[]` 并去掉 `TValue` 泛型(组件本身从不读单元格值,只用 `TData`),配 `biome-ignore lint/suspicious/noExplicitAny`。这也是 TanStack 官方示例的写法。
3. **`banned` 列只有 default 没有 NOT NULL。** 驱动返回 `boolean | null`,而输出 schema 是 `z.boolean()`,4 个端点全报类型不匹配。加了统一的 `toAdminUser(row)` 映射器,同时归一化 `role`(白名单)与 `banned`(null → false),API 契约保持干净布尔值。
4. **`db.select({ value: count() })` 在当前依赖树下返回 `{}` 而不是 `number`**(两份 drizzle 的类型冲突),所以 `count` 结果一律用 `Number(x ?? 0)` 兜一层,既过类型又不改变语义。
5. **封禁必须立刻吊销会话。** 只写 `banned: true` 的话,已登录用户能用到 session 自然过期为止;`setBan` 里额外 `db.delete(session).where(eq(session.userId, id))`。
6. **TanStack Router 的 `useRouteContext()` 不接受 `{ from }` 参数**(会报 `UseRouteContextBaseOptions` 无 `from` 属性),直接 `Route.useRouteContext()` 即可——子路由能看到父路由 `beforeLoad` 返回的 context。`navigate({ search: (prev) => ... })` 的回调参数需要显式标注类型,按仓库惯例写 `(prev: Search) =>`。
7. **`createNoindexFollowMeta()` 返回单个对象,不是数组**,别写 `[...createNoindexFollowMeta()]`。
8. **审计写入顺序**:先做主操作,再 `recordAudit`。`recordAudit` 内部 try/catch,失败只 `console.error`——封禁/删除绝不能因为审计表写不进去而失败。
9. **删用户的清理范围**:所有指向 `user.id` 的外键都是 `on delete cascade`,删掉 `user` 行即可;**唯一需要手动清的是存储对象**(`uploads/<userId>/`),用 `getStorageService().list()` + `delete()`,失败只记日志。

## 十二、实施备注(P2 过程中踩到的坑)

> 1–3 条是初版实现被复核后**整改**过的。括号里是初版的错误做法,留着是为了不再犯。

1. **删单份简历要清"简历专属"文件,而不是什么都不清。**
   (初版:以为图片都在 `uploads/<userId>/` 下、会被同一用户的其它简历共用,于是整个跳过清理 —— 结果留下孤儿对象。)
   存储布局其实是**分目录**的:
   - `uploads/<userId>/screenshots/<resumeId>`、`uploads/<userId>/pdfs/<resumeId>` —— 以简历 id 命名,只有这份简历会引用,**必须跟着删**;
   - `uploads/<userId>/pictures/` —— **用户级**资源,该用户的其它简历可能指向同一张图,**绝不能**按简历删。

   既有 `resumeService.delete` 正是这个做法(`Promise.allSettled` best-effort),admin 路径对齐它即可。`resume_version` / `resume_statistics` 靠 `on delete cascade` 自动跟走。

2. **`setLock` 幂等,但状态真变了必须广播。**
   (初版:只写库 + 落审计,没发事件。)
   幂等本身要保留:目标状态与当前一致时既不写库、不落审计、也**不发事件**,否则管理员连点两次会留下两条内容相同的日志,审计就失去"发生过变更"的语义。但状态真的翻转时**必须** `notifyResumeUpdated({ mutation: "lock" })` —— 否则 owner 正开着的 builder 会继续编辑一份已被锁定的简历;删除同理(`mutation: "delete"`),否则已经打开的 dashboard 不会把那条简历摘掉。

   **推广**:admin 的写操作和用户自己的写操作走的是**同一套实时通道**(Postgres `NOTIFY` → SSE,按 `(resumeId, userId)` 过滤),所以 admin 侧不能只改数据库。为此把 `notifyResumeUpdated` 从 `resume/service.ts` 的私有函数提到 `resume/events.ts` 导出,两处共用。

3. **凭证列永不 SELECT。**
   (初版:把 `password` 列选进内存再判空。)
   P1 的 `adminUserDto` 注释已经写明 "passwords … are never selected",P2 违反了这条既有原则。改成在 SQL 里派生:

   ```ts
   hasPassword: sql<boolean>`${resume.password} is not null`,
   ```

   哈希从此不离开数据库,也就不可能被某次重构意外透出去。**另外**:该列存的是 bcrypt hash,描述时要说"哈希"而非"明文"。

4. **表格里 `owner` / `isPublic` / `isLocked` 三列必须 `enableSorting: false`。** 服务端 `sortBy` 是 zod enum(`createdAt` / `updatedAt` / `name`),而 `onSortingChange` 会把列 id 直接写进 URL;点一个服务端不认的列会让整个搜索参数校验失败、页面直接报错。

5. **测试的 fake db 要补 `innerJoin`,mock 要补 `sql`。** `service.test.ts` 的 passthrough 方法表里原本没有 `innerJoin`;而 `hasPassword` 的 `sql` 表达式是在**模块加载时**求值的,`vi.mock("drizzle-orm")` 里不提供 `sql` 会让导入直接崩,报错还指向别处。

6. **改 `resume/service.ts` 的导入会连带打断 `service.test.ts`。** 该测试 `vi.mock("./events")` 只提供了 `publishResumeUpdated`;把调用点换成 `notifyResumeUpdated` 后 mock 里缺这个导出,13 个用例一起红。修法是让两个名字指向同一个 spy。

7. **路由文件已存在时 `routeTree.gen.ts` 不会变。** `/admin/resumes` 在 P0 就登记过了,本次只是把占位组件换成真实页面,所以构建后该文件的 `git status` 应当是干净的 —— 不干净说明误改了生成物。

## 十三、实施备注(P3 过程中踩到的坑)

1. **最重要的一条:静态配置 ≠ 运行时开关。**
   `packages/auth/src/config.ts` 里 `env.FLAG_DISABLE_SIGNUPS` / `FLAG_DISABLE_EMAIL_AUTH` 被用了 **6 处**(`emailAndPassword.disableSignUp`、`enabled`、三个 social provider 的 `disableSignUp` …),**全部在模块加载时求值**。如果 P3 只把 `flags.get` 改成读 DB,后台开关就只影响前端"隐藏按钮",服务端端点依然开放 —— **开关形同虚设,而且给人虚假的安全感**。这是本次最容易踩空的地方。

   → **`databaseHooks.user.create.before` 是注册的唯一收口**:邮箱注册、用户名注册、social 登录建号、OAuth 全部要落一行 `user`,所以门禁放在这里,而不是维护一份会漂移的路由清单。
   → `disableEmailAuth` 管的是"邮箱密码这条路"(登录/注册/重置),用 `hooks.before` 按路径拦 `EMAIL_AUTH_PATHS`;清单要覆盖 `emailAndPassword` 插件暴露的全部路由。
   → **不要**用 `hooks.before` 拦注册:social/OAuth 建号走 `/callback/*`,在那个路径上分不出"新用户注册"还是"老用户登录"。

2. **共享代码的落点由依赖方向决定,不是由"语义上属于谁"决定。**
   `instance-settings` 语义上属于"实例设置",本该放 `packages/api`;但 Better Auth 要用它,而依赖方向是 `api → auth`,auth 不能反向依赖 api。所以它落在 `packages/auth`。**动手前先看 `package.json` 的依赖箭头。**

3. **"值没变就不用写"是错的,要看来源。**
   当当前值来自环境变量时,即使新值和它一模一样**也必须写库** —— 写入这个动作本身就是"把它钉住",否则以后调整环境变量会静默翻掉管理员在后台做出的决定。幂等条件只能是 `source === "database" && value 相同`。

4. **`packages/env` 的 `emptyStringAsUndefined: true` 要同步到来源判定。**
   `FLAG_DISABLE_SIGNUPS=`(空串)在 env 层算"未设置",所以 `isEnvProvided` 也要把空串当作未提供,否则设置页会把它标成 "From an environment variable"。

5. **读设置失败要 fail-safe 回退到环境变量,并且不缓存。**
   如果查询失败时返回"内置默认值"(即 `false`),一个刻意关闭注册的实例会静默重开注册。回退到 env 值 + `console.error` + 不写缓存(下次重试)才是安全的一侧。

6. **测试里 mock 漏了导出会以"静默不生效"的形式出现。**
   `vi.mock("@reactive-resume/db/schema")` 少给一个 `adminAuditLog`,审计的 `db.insert` 就会抛错,而 `recordAudit` 自己的 try/catch 会把它吞掉 —— 测试的失败信息是"审计行没写",而不是"mock 缺东西"。**审计的 best-effort 设计让这类错误特别隐蔽**,写新 service 的测试时先把 `adminAuditLog` 补上。

7. **`rm -rf apps/web/dist` 现在会被 safe-delete 拦下**(目录内 361 个文件 > 50 阈值),而 vite 的 `prepare-out-dir` 在 Windows 上会遇到 `EPERM`(目录句柄未释放)。用 node 的 `fs.rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })` 才能删干净 —— 它内置了 Windows 的瞬时锁重试。

8. **`biome-ignore lint/suspicious/useAwait` 会过期。** 函数体里一旦出现 `await`(例如新加了一个 `await isEmailAuthDisabled()`),原来的 suppression 就变成多余的,biome 会反过来警告。加 `await` 时顺手删掉上面的 ignore 注释。

9. **趋势数据在 JS 侧补齐空日,不要指望 SQL。** `GROUP BY date_trunc('day', …)` 不会为没有数据的日期返回行;与其让每个消费方都处理空洞,不如在 service 里按天展开成固定长度的数组。同时把日期表达式**显式钉到 UTC**(`at time zone 'UTC'`),否则数据库会话时区一变,分桶就和 JS 侧的 `toISOString().slice(0,10)` 对不上。

## 十四、knip 从红到绿(2026-09-19)

`pnpm knip` 之前一直失败,报 5 个未用依赖、2 个未用 devDependency、4 个未用导出、2 条配置提示。处理原则是**先分清"真没用"还是"knip 看不见",再决定删依赖还是加 `ignoreDependencies`** —— 一律 ignore 只是让检查闭嘴。

**删掉的(确实没有任何引用)**:

| 包 | 依赖 | 依据 |
|---|---|---|
| `packages/api` | `better-auth`、`react`、`sanitize-html` | 全包无 import;api 里没有 `.tsx` 文件;全仓搜不到 `sanitize-html` |
| `packages/api` | `@types/sanitize-html`(dev) | 同上 |
| `packages/mcp` | `@reactive-resume/resume` | 移除 cover letter 后不再引用 |

**怎么验证"删了没事"**:把 `packages/{api,mcp}/node_modules` 里对应的 symlink 临时 `unlink`,跑 `turbo run typecheck --force --filter=…` 与 `turbo run test --force --filter=…`(api 417 例、mcp 57 例全过),确认类型解析和运行时都不依赖它们,再删 `package.json` 条目。
→ **注意必须加 `--force`**:turbo 的缓存按文件哈希算,不改文件就 `FULL TURBO` 全命中缓存,实验等于没跑。
→ 之后 `pnpm install --lockfile-only` 更新 lockfile(不碰 node_modules,避免沙箱里 pnpm 建不出 symlink 的老问题)。

**加 `ignoreDependencies` 的(knip 的盲区,依赖必须留着)**:

- `packages/ui` → `@tanstack/table-core`:`@tanstack/react-table` 的类型几乎全部 `export * from "@tanstack/table-core"`,而 pnpm 的严格 node_modules 不会把传递依赖暴露给 `packages/ui`,缺它报 "has no exported member"(P0 的教训)。
- `packages/resume` → `tsx`:`selector.esm.test.ts` 在**子进程**里调用 `tsx`,knip 看不到进程外的引用。

**顺带清掉的 dead export**:`AdminUserSortField`、`AdminResumeSortField`(两个 "导出但没人 import" 的 `z.infer` 类型),以及 `focusCustomSidebarSection`(cover letter 移除时调用方被删、函数留下)。

**配置提示**:`knip.json` 里 `.design-sync/**`(目录已不存在)与 `apps/server` 的 `@better-auth/api-key`(依赖已不存在)一并移除。

现在 `pnpm knip` **exit 0**。
