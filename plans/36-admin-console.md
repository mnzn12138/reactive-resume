# 36 — 后台管理界面(Admin Console)设计

> 状态:**P0 基座已完成**,**P1 用户管理已完成**,**P2 简历管理已完成**,P3 待实施
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
> - `packages/api/src/dto/admin.ts`:`adminResumeDto`(list / setLock / delete);输出只给 `hasPassword`,不含 `password` 明文与体积很大的 `data`
> - `packages/api/src/features/admin/resume-service.ts` + `resume-service.test.ts`(9 例全通过)
> - `packages/api/src/features/admin/sql.ts`:`escapeLike` 从 `service.ts` 抽出,两个 service 共用
> - `packages/api/src/features/admin/router.ts`:挂载 `resumes`(3 个端点,全部 `tags: ["Internal"]`)
> - `apps/web/src/routes/admin/resumes.tsx`:列表页替换占位(搜索防抖 / 可见性+锁定筛选 / 排序 / 服务端分页)
> - `apps/web/src/routes/admin/-components/resumes-table.tsx`:列定义 + 锁定解锁/删除行操作
> - 审计复用 P0 预留的 `resume.lock.set` / `resume.delete`,无需新迁移

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

1. **删单份简历不碰存储。** 上传的图片在 `uploads/<userId>/` 下,同一个用户的其它简历完全可能引用同一张图,按简历删文件会误删别人还在用的资源。只有"删账号"这条路径才清目录。`resume_version` / `resume_statistics` 靠 `on delete cascade` 自动跟走。
2. **`setLock` 必须幂等。** 目标状态与当前一致时既不写库也不落审计 —— 否则管理员连点两次会留下两条内容相同的日志,审计就失去了"发生过变更"的语义。`setRole` 已经是这个写法,照搬即可。
3. **owner 用 `innerJoin` 一次取回。** 列表和单条查询共用同一组 `listColumns`(扁平的 `ownerId` / `ownerEmail` …),再由 `toAdminResume` 收敛成 DTO 的嵌套 `owner`。`password` 也在这组列里,但只用来推导 `hasPassword`,不进入返回值。join 用 inner 是安全的:`resume.user_id` 是 `on delete cascade`,不存在没有 owner 的简历。
4. **表格里 `owner` / `isPublic` / `isLocked` 三列必须 `enableSorting: false`。** 服务端 `sortBy` 是 zod enum(`createdAt` / `updatedAt` / `name`),而 `onSortingChange` 会把列 id 直接写进 URL;点一个服务端不认的列会让整个搜索参数校验失败、页面直接报错。
5. **测试的 fake db 要补 `innerJoin`。** `service.test.ts` 的 passthrough 方法表里原本没有它,漏了会静默返回空结果而不是报错(chain 上没有该方法 → 抛错,但报错信息指向别处)。
6. **路由文件已存在时 `routeTree.gen.ts` 不会变。** `/admin/resumes` 在 P0 就登记过了,本次只是把占位组件换成真实页面,所以构建后 `routeTree.gen.ts` 的 `git status` 应当是干净的 —— 不干净说明误改了生成物。
