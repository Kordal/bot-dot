// What the chat draws of a reply, said once: every bot and the Chief of Staff get this text, so that they write
// what both apps draw (the rules are test/fixtures/markdown-cases.json). The apps draw a bold line as a title
// too, for the replies written before this was said.
const CHAT_FORMAT = `What the chat draws: your reply is shown as Markdown, and the chat draws this much of it:
- A section title: "## Title" on a line of its own, in place of a bold line. Use titles only in a reply of more than one section.
- Bullets: lines that start with "-".
- Numbered steps: lines that start with "1.", with a step's details indented under the step.
- Tables, quotes (lines that start with ">") and code blocks.
- Diagrams: a Mermaid diagram (flowchart, sequence, gantt and the like) in a code block that starts with "\`\`\`mermaid". Draw one only when a diagram explains it better than text. The web page draws it; the Android app shows its code with a link to the web page.`;

// How a reply opens and how long it is: for the Chief and for every bot.
// who: the person as that prompt calls them ("the owner" for a bot, "the user" for the Chief).
const answerFirst = (who) => `Start with the answer or the outcome, in one or two sentences. Aim for under 150 words. Go longer only when ${who} asked for a report or the details are the answer, and then give the reply sections.`;

module.exports = { CHAT_FORMAT, answerFirst };
