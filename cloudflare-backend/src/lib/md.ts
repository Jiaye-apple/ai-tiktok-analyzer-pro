/**
 * 极简 Markdown → HTML 渲染，专供 copy-script 四件套。
 *
 * 为什么在服务端渲染：插件端拿到 data 后是直接 dangerouslySetInnerHTML
 * 塞进 white-space:pre-wrap 的容器里（index.js AI 脚本面板），返回裸
 * Markdown 用户就会看到满屏 **、#、| 符号；往压缩过的前端 bundle 里塞
 * 一个 md 库也不现实，所以在这里转。
 *
 * 安全：输入先整体 HTML 转义，再做标记替换 —— 产物里只可能出现下面
 * 白名单里手写的标签，LLM 输出（或字幕里被注入）的 <script> 之类只会
 * 被当作文本显示。
 *
 * 容器是 pre-wrap，输出里的换行会被原样显示，所以块与块之间不留换行，
 * 间距全部用行内 margin 控制；只有 <pre> 内部保留换行。
 */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 行内标记：`code`、**加粗**、*斜体*。链接/图片故意不做，脚本场景用不上。 */
function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
}

const CELL_STYLE = 'border:1px solid #e5e5e5;padding:4px 8px;text-align:left';

function tableHtml(rows: string[][]): string {
  const tr = (cells: string[], tag: 'th' | 'td') =>
    `<tr>${cells.map((x) => `<${tag} style="${CELL_STYLE}">${inline(x)}</${tag}>`).join('')}</tr>`;
  const [head, ...body] = rows;
  return (
    '<table style="border-collapse:collapse;margin:8px 0;font-size:0.95em">' +
    tr(head, 'th') +
    body.map((r) => tr(r, 'td')).join('') +
    '</table>'
  );
}

function splitCells(line: string): string[] {
  // "| a | b |" -> ["a","b"]；首尾竖线是可选的
  const cells = line.split('|').map((x) => x.trim());
  if (cells[0] === '') cells.shift();
  if (cells.length && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

export function mdToHtml(md: string): string {
  const out: string[] = [];
  const lines = esc(md.replace(/\r\n/g, '\n')).split('\n');

  let list: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  const openList = (kind: 'ul' | 'ol') => {
    if (list !== kind) {
      closeList();
      out.push(`<${kind} style="margin:4px 0;padding-left:22px">`);
      list = kind;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 围栏代码块：原样保留内部换行（pre 本来就保换行）
    if (/^\s*```/.test(line)) {
      closeList();
      const buf: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) buf.push(lines[i]);
      out.push(
        `<pre style="background:#f6f6f6;padding:8px;border-radius:6px;overflow-x:auto;margin:6px 0">${buf.join('\n')}</pre>`,
      );
      continue;
    }

    // 表格：本行含 |，下一行是 |---|---| 分隔行
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      closeList();
      const rows = [splitCells(line)];
      for (i += 2; i < lines.length && lines[i].includes('|'); i++) rows.push(splitCells(lines[i]));
      i--;
      out.push(tableHtml(rows));
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const size = heading[1].length <= 1 ? '1.15em' : heading[1].length === 2 ? '1.05em' : '1em';
      out.push(
        `<div style="font-weight:700;font-size:${size};margin:12px 0 4px">${inline(heading[2])}</div>`,
      );
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeList();
      out.push('<hr style="border:none;border-top:1px solid #e5e5e5;margin:10px 0">');
      continue;
    }

    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      openList('ul');
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    const ordered = line.match(/^\s*\d+[.、)]\s+(.*)$/);
    if (ordered) {
      openList('ol');
      out.push(`<li>${inline(ordered[1])}</li>`);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    closeList();
    out.push(`<div style="margin:2px 0">${inline(line)}</div>`);
  }
  closeList();
  return out.join('');
}
