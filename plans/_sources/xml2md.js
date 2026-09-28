const fs = require("node:fs");

function conv(src, dst) {
	let s = fs.readFileSync(src, "utf8");

	// 去掉 frontmatter
	s = s.replace(/^---[\s\S]*?---\s*/, "");

	// Heading -> markdown
	s = s.replace(/<Heading[^>]*level="(\d)"[^>]*>/g, (_m, l) => `\n${"#".repeat(Number(l))} `);
	s = s.replace(/<\/Heading>/g, "\n");

	// Table 结构
	s = s.replace(/<\/?TableRow[^>]*>/g, "\n");
	s = s.replace(/<\/?TableCell[^>]*>/g, " | ");
	s = s.replace(/<\/?Table[^>]*>/g, "\n");

	// ListItem
	s = s.replace(/<ListItem[^>]*>/g, "\n- ");
	s = s.replace(/<\/ListItem>/g, "");

	// Paragraph
	s = s.replace(/<Paragraph[^>]*>/g, "");
	s = s.replace(/<\/Paragraph>/g, "\n");

	// 其余标签全部剥离
	s = s.replace(/<\/?[A-Za-z][^>]*>/g, "");

	// 实体
	s = s
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"');

	// 行尾反斜杠续行 -> 直接连接
	s = s.replace(/\\\n/g, "");

	// 压缩空行
	s = s.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n");

	fs.writeFileSync(dst, s, "utf8");
	console.log(dst, s.length, "chars");
}

conv("C:/Users/22586/AppData/Local/Temp/doc1.xml", "C:/Users/22586/AppData/Local/Temp/doc1.md");
conv("C:/Users/22586/AppData/Local/Temp/doc2.xml", "C:/Users/22586/AppData/Local/Temp/doc2.md");
