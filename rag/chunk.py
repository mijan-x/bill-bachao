"""Structure-aware (semantic) chunking of knowledge/*.md.
Each '## ' section becomes one chunk; sections longer than MAX_CHARS are split on paragraph
boundaries so a chunk never cuts a sentence or mixes two topics.
Output: rag/chunks.json  [{id, doc, doc_title, section, text}]"""
import json, pathlib, re

MAX_CHARS = 900
ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = {
    "tariff.md": "https://thefinancialexpress.com.bd/views/views/power-tariff-adjustment-alone-will-not-reduce-subsidy-burdens",
    "cooling.md": "https://ieefa.org/articles/energy-efficient-fans-could-cut-bangladeshs-peak-power-demand-2590mw-ieefa",
    "peak.md": "https://ieefa.org/articles/energy-efficient-fans-could-cut-bangladeshs-peak-power-demand-2590mw-ieefa",
    "safety.md": "https://github.com/mijan-x/bill-bachao/blob/main/knowledge/safety.md",
    "app-faq.md": "https://github.com/mijan-x/bill-bachao/blob/main/knowledge/app-faq.md",
}


def chunks():
    out = []
    for path in sorted((ROOT / "knowledge").glob("*.md")):
        text = path.read_text(encoding="utf-8")
        title = re.search(r"^# (.+)$", text, re.M).group(1).strip()
        for sec in re.split(r"^## ", text, flags=re.M)[1:]:
            heading, body = sec.split("\n", 1)
            paras, buf = [p.strip() for p in body.strip().split("\n\n") if p.strip()], ""
            for p in paras:
                if buf and len(buf) + len(p) > MAX_CHARS:
                    out.append((path.name, title, heading.strip(), buf)); buf = p
                else:
                    buf = f"{buf}\n\n{p}" if buf else p
            if buf:
                out.append((path.name, title, heading.strip(), buf))
    return [{"id": f"{d.removesuffix('.md')}-{i}", "doc": d, "doc_title": t, "section": s, "text": x,
             "source_url": SOURCE.get(d)} for i, (d, t, s, x) in enumerate(out)]


if __name__ == "__main__":
    c = chunks()
    (ROOT / "rag" / "chunks.json").write_text(json.dumps(c, ensure_ascii=False, indent=1), encoding="utf-8")
    for x in c:
        print(x["id"], "|", x["section"], "|", len(x["text"]))
