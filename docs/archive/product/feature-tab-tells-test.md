# Feature test: the web page's tab tells

The owner's test list for ALV-009 ([Kordal/bot-dot#338](https://github.com/Kordal/bot-dot/issues/338), from the spec [Kordal/bot-dot#329](https://github.com/Kordal/bot-dot/issues/329), report [2026-10-09](../../product/improvements/2026-10-09-bots-that-feel-alive.md)): while any chat has a new reply (a bot's chat, a Chief chat or a group) or anything waits in Needs you, the tab of the web page shows a mark before "botdot" in its title ("● botdot") and a dot on its icon. Both are gone once nothing is new and nothing waits. It is a mark and never a count. The browser asks nothing: there is no notification, no permission question and no sound. The web page only: Android has notifications. The botdot server is not changed.

How the icon with its dot looks in the tab is yours to judge on screen: no test can say whether it reads well at that size.

## Checked before the owner's test

- The page's tests passed (`test/tab-tells-web.test.js`): no mark while nothing is new and nothing waits; a mark for a new reply in a bot's chat, a Chief chat or a group, and for anything in Needs you; the same title for one as for many, with no digit; the marked icon is the page's own icon with one dot; the title and the icon go back when the last new reply is read and nothing waits; an icon that cannot be read leaves the title to tell; the page holds no notification, no permission question, no service worker and no sound.
- Walked once in a headless browser against a test botdot server with the stand-in Claude: a bot's reply, a Chief reply and a group's reply, each while another chat was on screen, put "● botdot" in the title and the marked icon in the tab's link, and opening that chat took both away. A script job waiting for an OK did the same with no dot in the list, and approving it took both away. The browser showed no question and the page reported no error.
- The marked icon was looked at as a picture at 16, 32, 64 and 256 pixels beside the plain one. Nobody looked at it in a real tab strip.

## How to start it

A test botdot server with scratch data, at least two bots and one group, open in a browser. Open a second tab with any other page, so that botdot's tab can be looked at while it is not in front. Do the steps in the browser you use every day.

## Steps

1. With nothing new and nothing waiting, look at the tab: it says "botdot" and shows the plain icon.
2. Open the Chief of Staff's chat. From the phone, or from a second browser window, send a message to a bot and wait for its reply. The tab of the first window says "● botdot" and its icon has a dot in its upper right corner. The bot's row in the list has its dots.
3. Go to the other tab. botdot's tab still says "● botdot" with the dot on its icon.
4. Come back and open that bot's chat. The dots in the list go, and the tab says "botdot" with the plain icon again.
5. Open a bot's chat. From the phone, send a message to the Chief of Staff and wait for the reply. The tab is marked. Open the Chief of Staff: the mark goes.
6. Open the Chief of Staff's chat. From the phone, write in a group and wait for a member's reply. The tab is marked. Open the group: the mark goes.
7. Have several chats with new replies at once. The tab says "● botdot" as for one: one mark, no number in the title and none on the icon.
8. Read them one after the other. The mark stays until the last one is read, then goes.
9. Ask the Chief of Staff for something that needs your OK (a job with a script, a tool to install, a permission). When "Waiting for your OK" stands above the page, the tab is marked, also when no row in the list has dots.
10. Open the card and look at it without answering. The mark stays: the thing still waits.
11. Approve or decline it. When nothing waits and nothing is new, the mark goes.
12. Let a scheduled job of a bot report while botdot's tab is not in front. The tab is marked when you look at the tab strip.
13. Let a bot work for a while without replying. The tab is not marked while it only works: a working bot is no new reply.
14. Reload the page while something is new or waits. The mark is there again once the page has loaded.
15. All through the steps: the browser asked for nothing, showed no notification and made no sound.

## The icon

1. Look at the marked icon in a light tab strip and in a dark one. The dot is seen in both, and the icon is still botdot's.
2. Pin the tab, if your browser has pinned tabs. A pinned tab shows no title: the dot on the icon is what tells.
3. In Safari the icon may not change: not checked. A browser that does not draw this page's icon in the tab, or does not follow a change to it, keeps the icon it had. The title's mark tells there.

## What cannot be tested by hand

- That a count the server did not send, or sent as something that is no number, marks nothing: `test/tab-tells-web.test.js`.
- That a mark which ended while the icon was still being read leaves the plain icon: the same tests.
- That the title holds no digit however many chats are new: the same tests.

## Owner acceptance

Not tested by the owner yet.
