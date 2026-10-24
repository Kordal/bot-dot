Script jobs can use saved SSH keys
- A script job can reach a server over SSH with a key from the Vault, for checks like a morning infra review.
- botdot signs for the script, so the key is never in the script, a file or its environment.
