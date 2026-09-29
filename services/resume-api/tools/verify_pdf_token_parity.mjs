// M5 · PDF 下载令牌的「Node ↔ Python」互签校验脚本（只做校验，不进生产链路）。
//
// 为什么要有这个脚本：`app/pdf_token.py` 是照 Node `pdf-download-url.ts` 重刻的一份
// HMAC 签名。重刻的东西最容易在「看起来对」的情况下悄悄漂移（base64url 填充、JSON
// 紧凑度、毫秒 vs 秒……）。只靠 Python 自签自验是**自证**，证明不了 Node 认不认。
// 这个脚本用 Node **真实**的实现（不是再抄一份）双向验一遍：
//
//   --make <resumeId> <userId> <ttlSeconds>   Node 真签一个令牌（给 Python 侧反向验）
//   --verify <token> <resumeId>               Python 签的令牌交给 Node 真实实现去验
//
// 跑法（必须从 apps/server 发起，否则 `@reactive-resume/env/server` 解析不到；
// AUTH_SECRET 由 packages/env 自己从仓库根 .env 读取，Python 侧读的是同一个文件）：
//
//   cd apps/server
//   node --import tsx <repo>/services/resume-api/tools/verify_pdf_token_parity.mjs \
//        --make r1 u1 600
//
// 退出码：0 = 校验通过；1 = 用法错误；2 = Node 侧判定为不合法。

const [mode, ...rest] = process.argv.slice(2);

const MODULE_URL = new URL("../../../packages/api/src/features/resume/pdf-download-url.ts", import.meta.url).href;

const { createResumePdfDownloadUrl, verifyResumePdfDownloadToken } = await import(MODULE_URL);

function usage() {
	console.error(
		"usage: verify_pdf_token_parity.mjs --make <resumeId> <userId> [ttlSeconds]\n" +
			"       verify_pdf_token_parity.mjs --verify <token> <resumeId>",
	);
	process.exit(1);
}

if (mode === "--make") {
	const [resumeId, userId, ttlSeconds] = rest;
	if (!resumeId || !userId) usage();

	const result = createResumePdfDownloadUrl({
		resumeId,
		userId,
		ttlSeconds: ttlSeconds ? Number.parseInt(ttlSeconds, 10) : undefined,
	});

	// 只打令牌本身：Python 侧的测试要用它做反向验签的输入。
	console.log(result.url.split("token=")[1] ?? "");
	process.exit(0);
}

if (mode === "--verify") {
	const [token, resumeId] = rest;
	if (!token || !resumeId) usage();

	const verification = verifyResumePdfDownloadToken({ resumeId, token });
	console.log(JSON.stringify(verification));
	process.exit(verification.ok ? 0 : 2);
}

usage();
