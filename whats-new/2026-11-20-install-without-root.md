Bots install programs without root
- A bot now installs a program on its computer into its home first, with botdot-install or a downloaded binary, so it works where sudo does not.
- Where sudo fails on a computer, the bot says that plainly and does not keep trying it.
- A program only apt has cannot be installed there, and the bot tells you so.
