# Deleting your botdot account

Your botdot account and its data (bots, chats, files, notes, the Board) are kept on the botdot server you sign in to, not by the app's developer. The developer holds no copy and cannot delete it for you.

- **Your own server** (you installed botdot): you are its admin. Open `https://<your server>/admin`, choose your account and Delete, or remove the whole install with `sudo sh install.sh --uninstall` on the server.
- **An account on someone else's machine**: ask its admin to delete it. They do it in the admin page (Accounts → the account → Delete), which erases the account's data, containers, files and passkeys at once.

Uninstalling the app removes what it kept on the phone (the session, the server's address and cached files), not the account.
