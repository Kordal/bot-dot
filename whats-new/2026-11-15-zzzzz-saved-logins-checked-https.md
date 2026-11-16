Saved logins reach public services only over checked https
- A bot's request with a saved login to a public address now goes over https only, on its usual port, and checks the server's certificate.
- Your own servers at home or on your tailnet keep working as before, self-signed certificates and other ports included.
- A request that does not meet this is refused before the secret is sent, and the bot is told why.
