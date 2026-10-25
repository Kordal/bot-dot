Bots sign in to git by themselves
- A bot's git and ssh use the SSH keys you share with it, not only on its computer.
- A GitHub App you share with a bot lets its git clone and push over HTTPS, with a token that ends within the hour.
- Nothing is written into the repository, and the bot never sees the key.
