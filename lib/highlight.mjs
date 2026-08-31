/* A small TS/JS tokenizer. No dependency: the site has one (marked) and a
   highlighter is not worth a second, especially one that ships to the browser —
   this runs at render time on the server and emits plain spans. */

const ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (s) => s.replace(/[&<>"']/g, (c) => ESCAPE[c]);

const KEYWORDS =
  "import|from|export|default|const|let|var|function|return|await|async|if|else|throw|new|class|extends|implements|interface|type|enum|for|of|in|while|do|switch|case|break|continue|try|catch|finally|typeof|instanceof|delete|void|yield|static|readonly|public|private|protected|as|satisfies|null|undefined|true|false|this|super";

/* Order is the whole design: a comment containing a quote must not be read as a
   string, and a capitalised call must be a function before it is a type. */
const RULES = [
  ["comment", new RegExp(String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`, "y")],
  ["string", new RegExp(String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\`(?:[^\`\\]|\\.)*\``, "y")],
  ["number", new RegExp(String.raw`\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b`, "yi")],
  ["keyword", new RegExp(String.raw`\b(?:${KEYWORDS})\b`, "y")],
  /* Lower-case only: a capitalised call is a constructor or a component and
     reads better as a type, and colouring `Route` one way in an import and
     another two lines below is worse than either choice on its own. */
  ["function", new RegExp(String.raw`\b[a-z_$][\w$]*(?=\s*\()`, "y")],
  ["type", new RegExp(String.raw`\b[A-Z][\w$]*\b`, "y")],
  ["punctuation", new RegExp(String.raw`[{}()[\].,;:=<>+\-*/%!?&|^~]+`, "y")],
];

export function highlight(code) {
  let out = "";
  let plain = "";
  let at = 0;

  const flush = () => {
    if (plain) out += escape(plain);
    plain = "";
  };

  while (at < code.length) {
    let matched = false;

    for (const [kind, re] of RULES) {
      re.lastIndex = at;
      const m = re.exec(code);
      if (!m) continue;

      flush();
      out += `<span class="tok-${kind}">${escape(m[0])}</span>`;
      at = re.lastIndex;
      matched = true;
      break;
    }

    if (!matched) {
      plain += code[at];
      at += 1;
    }
  }

  flush();
  return out;
}
