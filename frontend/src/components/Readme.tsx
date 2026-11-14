import { useMemo } from "react";
import DOMPurify from "dompurify";

const ALLOWED_TAGS = ["p", "a", "img", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "code", "strong", "em", "b", "i", "del", "br", "hr", "table", "thead", "tbody", "tr", "th", "td", "div", "span", "details", "summary", "sup", "sub", "kbd"];
const ALLOWED_ATTR = ["href", "src", "alt", "title", "width", "height", "align", "colspan", "rowspan"];

export default function Readme({ html }: { html: string }) {
  const clean = useMemo(() => {
    const doc = new DOMParser().parseFromString(DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR }), "text/html");
    doc.querySelectorAll("a").forEach((a) => {
      a.target = "_blank";
      a.rel = "noopener noreferrer nofollow";
    });
    doc.querySelectorAll("img").forEach((img) => {
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
    });
    doc.querySelectorAll("table").forEach((t) => {
      const wrap = doc.createElement("div");
      wrap.className = "table-wrap";
      t.replaceWith(wrap);
      wrap.appendChild(t);
    });
    return doc.body.innerHTML;
  }, [html]);

  return <div className="readme" dangerouslySetInnerHTML={{ __html: clean }} />;
}
