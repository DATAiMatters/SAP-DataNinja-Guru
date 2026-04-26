import "server-only";
import MarkdownIt from "markdown-it";

// html: false → raw HTML in source is escaped to text. Safe by default.
// linkify: true → bare URLs become links.
// breaks: true → newlines in source become <br/> (familiar from chat UIs).
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
});

export function renderMarkdown(text: string): string {
  return md.render(text);
}
