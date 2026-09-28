import zipfile, re, sys

p = "C:/Users/22586/AppData/Local/Temp/doc3.docx"
z = zipfile.ZipFile(p)
xml = z.read("word/document.xml").decode("utf-8")

# 段落
xml = xml.replace("</w:p>", "\n")
# tab / break
xml = xml.replace("<w:tab/>", "\t")
xml = xml.replace("<w:br/>", "\n")

# 去掉所有标签
out = []
i = 0
for chunk in re.split(r"(<[^>]+>)", xml):
    if chunk.startswith("<"):
        continue
    out.append(chunk)

text = "".join(out)
text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'")
# 压缩空行
lines = [l.rstrip() for l in text.split("\n")]
res = []
for l in lines:
    if l.strip() == "" and (not res or res[-1] == ""):
        continue
    res.append(l)
text = "\n".join(res)
with open("C:/Users/22586/AppData/Local/Temp/doc3.txt", "w", encoding="utf-8") as f:
    f.write(text)
print("chars:", len(text), "lines:", len(res))
