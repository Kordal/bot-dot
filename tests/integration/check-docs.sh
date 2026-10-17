#!/usr/bin/env bash
# Documentation checks, part of `make lint`. For every Markdown file of the
# repository (tracked, or new and not ignored):
#
#   - every relative link points to a file that exists and that Git does not
#     ignore (an ignored file would be missing from a clone);
#   - a link with an anchor to a Markdown file names a heading of that file,
#     and a bare #anchor a heading of its own file;
#   - a reference link, [text][label] or [label][], names a label that the
#     same file defines.
#
# The targets checked are those of an inline link or image, [text](target),
# and of a reference definition written on one line, "[label]: target": the
# target optionally in <angle brackets>, with or without a title. A "?query"
# is dropped, and a target that starts with "/" is read from the repository
# root. A link that leads out of the repository, any "scheme:" and "//host",
# is not fetched.
#
# Not read, for links, references or headings:
#   - a fenced code block: from a line of three or more backticks or tildes,
#     with or without an info string, to a line of the same character at least
#     as long, or to the end of the file. A fence may be indented and stand
#     behind a block-quote or list marker: then the block ends with that quote
#     or list item at the latest;
#   - an HTML comment, up to its "-->". Without one, "<!--" is text and hides nothing;
#   - a code span of one or more backticks, which may wrap inside its paragraph.
# Not checked either: a path named in running text, and a shortcut reference,
# [text] alone, which is also what a task-list checkbox and a footnote look
# like.
#
# This is not a Markdown parser: an indented code block reads as prose, only
# "#" headings give anchors, a table row is known by its leading pipe, a
# fenced block in a list item inside a quote ends with the quote, and a
# definition spread over several lines counts as defined without its target
# being checked. Two bracket pairs in a row are read as a reference only in a
# file that defines a label at all, and not behind a letter, a digit, "]" or
# ")", where they index: rows[0][1]. Where such a file means no link by them,
# as in "cmd [options][file]", they go in a code span or behind a backslash,
# "\[".
#
# Needs git and a local Node.js: `make lint` skips it, saying so, when there is
# none. The Tests workflow runs it and its tests, scripts/check-docs.test.mjs,
# on every pull request.
set -euo pipefail

cd "$(dirname "$0")/../.."

list=$(mktemp)
trap 'rm -f "$list"' EXIT
# NUL-separated, and so written straight to the file, a variable holding no NUL: listed on lines, a name with a double
# quote, a backslash or a control character comes quoted, and the quoted name is no file to read.
git ls-files -z --cached --others --exclude-standard -- '*.md' >"$list"
if [ ! -s "$list" ]; then
	echo "FAIL  check-docs.sh found no Markdown files: not the repository root, or git failed"
	exit 1
fi

node - "$list" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// The index still lists a file that was deleted and not yet staged: there is nothing to read, and a link to it fails below.
const files = fs.readFileSync(process.argv[2], "utf8").split("\0").filter((file) => file && fs.existsSync(file));
let links = 0;
// The failures, in the order found. One that names a path counts only if Git ignores that path: asked once, at the end.
const report = [];
const fail = (message, ifIgnored) => report.push({ message, ifIgnored });

// What is read as Markdown: a file without its fenced code blocks and HTML
// comments, and with no bracket left in its code spans. A span keeps its text,
// which a heading's anchor and a reference label are made of, and loses what
// reads as a link. Whichever opens first wins: a fence line inside a comment
// opens nothing, and "<!--" inside code opens no comment.
const ITEM = "(?:[-*+]|\\d+[.)])[ \\t]";
// A backtick fence has no backtick in its info string: ```x``` is a code span.
const FENCE = "(`{3,}(?![^\\n]*`)|~{3,})";
// What a block may stand behind: indentation, block-quote and list markers.
const LEAD = "(?:[ \\t>]|" + ITEM + ")*";
// A fence stands behind any depth of those, not CommonMark's three spaces: they count from the enclosing list item,
// and a fence that is missed turns its code into prose. A backslash escapes a comment or a span unless it is escaped
// itself: only an odd number of them does.
const OPENER = new RegExp("^" + LEAD + FENCE + "|(?<!(?<!\\\\)(?:\\\\\\\\)*\\\\)(?:<!--|`+)", "gm");
// A setext underline of any length, a thematic break, the delimiter row of a table.
const RULE = "(?:=+|:?-[-|: \\t]*|(?:\\*[ \\t]*){3,}|(?:_[ \\t]*){3,})[ \\t]*$";
// A code span, or a comment inside a line, may wrap inside its paragraph. It never crosses a blank line or the start
// of another block (a list item, a table row, a heading, a fence, a rule, a quote after a line that is none), so that
// one stray backtick cannot hide the rest of a list.
const BREAK = new RegExp("^[ \\t>]*(?:$|\\||#{1,6}[ \\t]|" + ITEM + "|" + FENCE + "|" + RULE + ")|(?<=^(?![ \\t]*>).*\\n)[ \\t]*>", "gm");
// A heading and a table row are one line: a span opened there ends there.
const ONE_LINE = new RegExp("^" + LEAD + "(?:#{1,6}[ \\t]|\\|)");
// What stands before a comment that starts a block.
const BLOCK = new RegExp("^" + LEAD + "$");
const prose = new Map();
const proseOf = (file) => {
  if (prose.has(file)) return prose.get(file);
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const find = (pattern, from) => {
    pattern.lastIndex = from;
    return pattern.exec(text);
  };
  const lineAfter = (from) => text.indexOf("\n", from) + 1 || text.length + 1;
  const lineUpTo = (index) => text.slice(text.lastIndexOf("\n", index - 1) + 1, index);
  // The line that leaves the quote or the list item of a fence, and so ends its block: the first that is no quote, or
  // the first indented less than the item's text. A fence that is only indented looks upward for its item: the nearest
  // shallower line, if that opens an item whose text starts no deeper than the fence. None: the top level, no such line.
  const leaving = (lineStart, lead) => {
    if (lead.includes(">")) return /^(?![ \t]*>)/m;
    let width = new RegExp(ITEM).test(lead) ? lead.length : 0;
    for (let indent = lead.length, end = lineStart - 1; !width && indent > 0 && end > 0; ) {
      const start = text.lastIndexOf("\n", end - 1) + 1, line = text.slice(start, end), depth = /^[ \t]*/.exec(line)[0].length;
      if (depth < indent && depth < line.length) {
        const item = new RegExp("^[ \\t]*" + ITEM).exec(line);
        if (item && item[0].length <= lead.length) width = item[0].length;
        else indent = depth;
      }
      end = start - 1;
    }
    return width ? new RegExp("^ {0," + (width - 1) + "}[^ \\t\\n]", "m") : null;
  };
  let out = "", at = 0, stop = -1, arrow = 0;
  for (let open; (open = find(OPENER, at)); ) {
    const [mark, fence] = open, from = open.index + mark.length;
    // An unclosed fence runs to the end of the file, or of its quote or list item; an unclosed comment or run of
    // backticks is just text.
    let end = text.length, kept = "";
    if (fence) {
      const next = lineAfter(from), close = find(new RegExp("^[ \\t>]*" + fence[0] + "{" + fence.length + ",}[ \\t]*$", "gm"), next);
      if (close) end = close.index + close[0].length;
      const left = leaving(open.index, mark.slice(0, -fence.length))?.exec(text.slice(next, end));
      if (left) end = next + left.index - 1; // the line break stays: what follows starts a block
    } else if (mark === "<!--") {
      // The next "-->" holds for every "<!--" before it, and none for all that follow: looked up again only once passed.
      if (arrow >= 0 && arrow < open.index + 2) arrow = text.indexOf("-->", open.index + 2);
      // A comment that starts its line, quote or list item is a block, closed wherever its "-->" stands; any other
      // closes inside its paragraph.
      const closed = arrow >= 0 && arrow < (BLOCK.test(lineUpTo(open.index)) ? text.length : find(BREAK, lineAfter(from))?.index ?? text.length);
      end = closed ? arrow + 3 : from;
      kept = closed ? " " : mark; // not nothing: "[a]<!-- -->(b)" is no link
    } else {
      // Where the paragraph ends holds for every span of it: looked up again only once passed.
      const next = lineAfter(from);
      if (stop < next) stop = find(BREAK, next)?.index ?? text.length;
      const close = new RegExp("(?<!`)" + mark + "(?!`)").exec(text.slice(from, ONE_LINE.test(lineUpTo(open.index)) ? Math.min(stop, next - 1) : stop));
      end = close ? from + close.index + mark.length : from;
      kept = close ? text.slice(open.index, end).replace(/[\[\]]/g, "") : mark;
    }
    out += text.slice(at, open.index) + kept;
    at = end;
  }
  prose.set(file, out + text.slice(at));
  return prose.get(file);
};
// GitHub's heading anchors: lower case, the underscores of emphasis and the punctuation removed, spaces to hyphens.
// A code span keeps its underscores, and a letter its combining marks.
const slug = (heading) =>
  heading.trim().toLowerCase().replace(/`[^`]*`|(?<![\p{L}\p{N}])_+(?=\S)(.+?)(?<=\S)_+(?![\p{L}\p{N}])/gu, (all, inner) => inner ?? all)
    .replace(/`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");
const anchors = new Map();
const anchorsOf = (file) => {
  if (!anchors.has(file)) {
    // A repeated heading gets -1, -2, ... as GitHub numbers it. A heading may be indented up to three spaces, stand
    // in a quote and end in closing hashes.
    const seen = new Map();
    anchors.set(file, new Set([...proseOf(file).matchAll(/^ {0,3}(?:> {0,3})*#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/gm)].map((match) => {
      const base = slug(match[1]), count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      return count ? `${base}-${count}` : base;
    })));
  }
  return anchors.get(file);
};
// Labels match whatever their spacing and, lower-cased where they are compared, their case.
const label = (text) => text.trim().replace(/\s+/g, " ");
const decode = (part) => {
  try { return decodeURIComponent(part); } catch { return part; /* not percent-encoded */ }
};
const TITLE = "(?:\"[^\"]*\"|'[^']*'|\\([^()]*\\))";
// A target in angle brackets may hold spaces; a bare one may hold parentheses in pairs, as in "file_(1).md".
const INLINE = new RegExp("\\]\\(\\s*(?:<([^<>\\n]+)>|((?:[^()\\s<]|\\([^()\\s]*\\))(?:[^()\\s]|\\([^()\\s]*\\))*))(?:\\s+" + TITLE + ")?\\s*\\)", "g");
const DEFINITION = new RegExp("^(" + LEAD + ")\\[(?!\\^|[ \\t]*\\])([^\\[\\]\\n]+)\\]:[ \\t]*(.*)$");
const TARGET = new RegExp("^(?:<([^<>]+)>|([^\\s<>]+))(?:[ \\t]+" + TITLE + ")?[ \\t]*$");
// A line that is no text of a paragraph: an empty one, a heading, a rule.
const NO_TEXT = new RegExp("^(?:$|#{1,6}(?:[ \\t]|$)|" + RULE + ")");
const REFERENCE = /(?<![\\\p{L}\p{N}\])]|[\p{L}\p{N}]_+)\[(?!\^)([^\[\]]*)\]\[(?!\^)([^\[\]]*)\]/gu;

for (const file of files) {
  const text = proseOf(file);
  const check = (link) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(link)) return;
    links += 1;
    // Cut before it is decoded: "%23" and "%3F" belong to the name of a file. A query names no other file.
    const [, raw, anchor = ""] = /^([^?#]*)(?:\?[^#]*)?(?:#(.*))?$/s.exec(link);
    const target = decode(link), relative = decode(raw), heading = decode(anchor);
    // "/path" starts at the repository root, which is where this runs.
    const resolved = relative === "" ? file : path.normalize(relative.startsWith("/") ? relative.replace(/^\/+/, "") : path.join(path.dirname(file), relative));
    if (!fs.existsSync(resolved)) return fail(`${file}: link to ${target}: ${resolved} does not exist`);
    fail(`${file}: link to ${target}: ${resolved} is ignored by Git and would be missing from a clone`, resolved);
    if (heading && resolved.endsWith(".md") && !anchorsOf(resolved).has(heading)) fail(`${file}: link to ${target}: no heading "#${heading}" in ${resolved}`);
  };
  for (const match of text.matchAll(INLINE)) check(match[1] ?? match[2]);
  // "[^note]: text" is a footnote. Any other line that starts with "[label]:" defines its label, also in a form whose
  // target is not read here (on the next line): an unread definition must not fail the references to it. Unless the
  // line continues a paragraph, which no definition interrupts: "[x]: done" under a line of text is text.
  const defined = new Set();
  // "text": inside a paragraph. "defined": behind a definition, whose target or title may stand on a line of its own.
  let state = "", depth = 0;
  for (const line of text.split("\n")) {
    const lead = /^[ \t>]*/.exec(line)[0], quotes = lead.split(">").length - 1, match = DEFINITION.exec(line);
    // A list item and a deeper quote start a block of their own.
    if (match && (state !== "text" || match[1] !== lead || quotes > depth)) {
      defined.add(label(match[2]).toLowerCase());
      const target = TARGET.exec(match[3]);
      if (target) check(target[1] ?? target[2]);
      state = "defined";
    } else if (NO_TEXT.test(line.slice(lead.length))) state = "";
    else if (state !== "defined") state = "text";
    depth = quotes;
  }
  // Two bracket pairs in a row are a reference only where the file defines a label at all: without one they are a
  // pattern or usage text, which renders as written. Nor behind a letter, a digit, the underscore that ends a name,
  // "]" or ")": that is indexing, as in rows[0][1].
  if (defined.size > 0) for (const match of text.matchAll(REFERENCE)) {
    const name = label(match[2]) || label(match[1]);
    if (name && !defined.has(name.toLowerCase())) fail(`${file}: reference to [${name}]: no definition "[${name}]: <target>" in this file (not a link? use a code span or \\[)`);
  }
}
// One git for every target, not one for each link. It dies on a path that it cannot take, one outside the repository
// or beyond a symbolic link: then each path is asked alone, where such a one is simply not ignored.
const asked = [...new Set(report.map((entry) => entry.ifIgnored).filter(Boolean))];
const batch = asked.length > 0 ? spawnSync("git", ["check-ignore", "-z", "--stdin"], { input: asked.join("\0") + "\0", encoding: "utf8" }) : { status: 1, stdout: "" };
const ignored = new Set(batch.status === 0 || batch.status === 1 ? batch.stdout.split("\0") : asked.filter((target) => spawnSync("git", ["check-ignore", "-q", target], { stdio: "ignore" }).status === 0));
const failures = report.filter((entry) => !entry.ifIgnored || ignored.has(entry.ifIgnored));
for (const { message } of failures) console.error(`FAIL  ${message}`);
if (failures.length > 0) {
  console.error(`\n${failures.length} documentation check(s) failed`);
  process.exit(1);
}
console.log(`PASS  ${links} relative links in ${files.length} Markdown files point to existing, tracked files and headings`);
NODE
