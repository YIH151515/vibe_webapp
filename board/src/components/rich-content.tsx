import type { ReactNode } from "react";
import { normalizeDocument, type RichDocument, type RichBlock, type RichInline, type RichListItem } from "@/lib/posts/document";

type Node = RichBlock | RichInline | RichListItem;
function render(node: Node, key: number): ReactNode {
  if (node.type === "text") {
    let value: ReactNode = node.text;
    for (const mark of node.marks ?? []) {
      switch (mark.type) {
        case "bold": value = <strong>{value}</strong>; break;
        case "italic": value = <em>{value}</em>; break;
        case "underline": value = <u>{value}</u>; break;
        case "strike": value = <s>{value}</s>; break;
        case "link": value = <a href={mark.attrs.href} target="_blank" rel="noopener noreferrer">{value}</a>; break;
      }
    }
    return <span key={key}>{value}</span>;
  }
  if (node.type === "hardBreak") return <br key={key} />;
  // Dynamic, SQL-authorized app route; next/image optimization must not cache drafts.
  // eslint-disable-next-line @next/next/no-img-element
  if (node.type === "image") return <img key={key} src={`/api/images/${node.attrs.assetId}`} alt={node.attrs.alt} loading="lazy" />;
  const children = (node.content ?? []).map(render);
  switch (node.type) {
    case "paragraph": return <p key={key}>{children.length ? children : <br />}</p>;
    case "heading": return node.attrs.level === 2 ? <h2 key={key}>{children}</h2> : <h3 key={key}>{children}</h3>;
    case "blockquote": return <blockquote key={key}>{children}</blockquote>;
    case "bulletList": return <ul key={key}>{children}</ul>;
    case "orderedList": return <ol key={key} start={node.attrs.start}>{children}</ol>;
    case "listItem": return <li key={key}>{children}</li>;
  }
}
export function RichContent({ document }: { document: RichDocument }): React.JSX.Element {
  const safe = normalizeDocument(document).document;
  return <div className="post-content rich-content">{safe.content.map(render)}</div>;
}
