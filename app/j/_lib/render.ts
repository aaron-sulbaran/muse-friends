// The /j pages are plain server-rendered HTML on purpose: a judge's Muse reads them in its own built-in
// browser, so there is no script, no cookie, no client component, and every control is a native form element.

export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const STYLE = `
  body { font: 16px/1.55 -apple-system, system-ui, "Segoe UI", sans-serif; margin: 0; background: #fafafa; color: #000; }
  main { max-width: 38rem; margin: 0 auto; padding: 1.25rem 1rem 3rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .5rem; letter-spacing: -.01em; }
  h2 { font-size: 1.1rem; margin: 1.5rem 0 .4rem; }
  p { margin: .5rem 0; }
  .note { color: #68696d; font-size: .9rem; }
  .card { background: #fff; border-radius: 16px; padding: 1rem 1.1rem; margin: 1rem 0; box-shadow: 0 1px 6px rgba(0,0,0,.08); }
  .error { background: #fff3f2; border-left: 4px solid #c0392b; padding: .6rem .8rem; border-radius: 8px; margin: 1rem 0; }
  .ok { background: #effaf1; border-left: 4px solid #2e7d32; padding: .6rem .8rem; border-radius: 8px; margin: 1rem 0; }
  label { display: block; padding: .55rem 0; }
  input[type=checkbox] { width: 1.15rem; height: 1.15rem; margin-right: .55rem; vertical-align: -3px; }
  button { font: inherit; font-weight: 600; border: 0; border-radius: 999px; padding: .65rem 1.3rem; margin: .4rem .5rem .4rem 0; background: #0f61d7; color: #fff; cursor: pointer; }
  button.secondary { background: #e5e7eb; color: #000; }
  blockquote { margin: .6rem 0; padding: .6rem .9rem; background: #f3f4f6; border-radius: 12px; }
  ul { padding-left: 1.2rem; }
  fieldset { border: 0; margin: 0; padding: 0; }
  legend { font-weight: 600; padding: 0; }
`;

export function htmlPage(input: { title: string; body: string; refreshSeconds?: number }): string {
  const refresh = input.refreshSeconds ? `<meta http-equiv="refresh" content="${input.refreshSeconds}">` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
${refresh}
<title>${esc(input.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${input.body}
</main>
</body>
</html>`;
}

export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
