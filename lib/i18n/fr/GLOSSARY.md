# French words

The French glossary: [lib/i18n/GLOSSARY.md](../GLOSSARY.md) says what each English term is in botdot, this file what it is in French. The same words go in the dictionary, the What's new notes in `whats-new/fr/` and the Play listing (`docs/google-play/listing-fr.md`).

- **The owner is "tu"**, lowercase ("ton", "ta", "tes", "toi"), as French chat and social apps speak to their users (Discord, Snapchat, Spotify). botdot is a tool you talk to all day; "vous" would read like a bank.
- **A button or a menu item is an infinitive**, as French apps write them: "Enregistrer", "Annuler", "Supprimer", "Réessayer". A heading is a noun: "Paramètres", "Mises à jour". A state is a short adjective or phrase: "Au travail", "Terminé". A hint or a placeholder speaks to the owner in the imperative: "Choisis le fichier", "Écrire au Chef…" (a placeholder stays an infinitive).
- **Names stay as they are:** botdot (lowercase, no article: « botdot se met à jour »), Claude, Claude Code, Gmail, Composio, boat.dev, Bitwarden, Haiku, Sonnet, Opus, GitHub, Google Play, Tailscale.
- **A bot is "il"**: bots, the Chief and a Project Manager are masculine ("Il a terminé", "Je me suis arrêté"). A page, a job (tâche) and a skill (compétence) are feminine: "planifiée", "lancée", "créée".
- **Typography:** a narrow no-break space (U+202F) before `?` `!` `;`, a no-break space (U+00A0) before `:` and inside « », so a lone "?" never wraps onto its own line on a phone. Quotes are « ». "Appli" for an app (short, as banks, SNCF and most French apps say it). Mo and Go for MB and GB.
- **Short:** a button stays a word or two. Where the natural French is long ("Autoriser une fois"), it still fits a button; a longer one is cut to its verb ("Reconnecter"). "Couldn't …" is « Impossible de … » or « … impossible » ("Envoi impossible"); "This can't be undone" is « C'est définitif ».

| English | French |
| --- | --- |
| bot | bot (le bot, les bots) |
| Chief of Staff / the Chief | Chef de cabinet / le Chef |
| Project Manager | Chef de projet |
| main assignment | mission principale |
| task (a run's request) | demande |
| job / scheduled job | tâche / tâche planifiée |
| script job | tâche script |
| run | exécution |
| chat | discussion (« Nouvelle discussion », « Ouvrir la discussion ») |
| Needs you | Pour toi |
| card | carte |
| Board / tile | Tableau / tuile |
| keypad / key | clavier / touche |
| page / Pages | page / Pages |
| interactive page | page interactive |
| Vault / Passwords | Coffre / Mots de passe |
| login (a saved one) | identifiant |
| passkey | clé d'accès |
| Settings / Updates / Activity / Usage | Paramètres / Mises à jour / Activité / Utilisation |
| Storage / Feedback | Stockage / Avis |
| What's new | Nouveautés |
| Home / Spaces | Accueil / Espaces |
| Connectors / connected apps | Connecteurs / applis connectées |
| Marketplace / Providers | Catalogue / Fournisseurs |
| Files / Workspace | Fichiers / Espace de travail |
| Keep in mind (the place) / keep in mind (the action) | À retenir / Retenir |
| group | groupe |
| shared room / Rooms | salon partagé / Salons |
| category | catégorie |
| project | projet |
| team / lead | équipe / responsable |
| To-do (a project's list) | À faire |
| standup | point du matin |
| check-in / Monthly review | Bilan du jour {n} / Bilan du mois |
| Project update | Nouvelles du projet |
| the Chief's checkup | revue du Chef |
| a bot's weekly review (of its notes) | revue hebdomadaire |
| skill / helpers | compétence / assistants |
| note / pinned | note / épinglée |
| teammate | coéquipier |
| account's computer | ordinateur du compte |
| External Virtual PC | PC virtuel externe |
| screenshot | capture d'écran |
| working line | ligne d'activité |
| answer buttons | boutons de réponse |
| quiet hours | heures calmes |
| Sign in / Sign out | Se connecter / Se déconnecter |
| Approve / Always approve / Always approved | Approuver / Toujours approuver / Toujours approuvé |
| Always allow / Allow once / Decline | Toujours autoriser / Autoriser une fois / Refuser |
| Always allowed / Revoke | Toujours autorisé / Révoquer |
| Delete / Remove | Supprimer (« Retirer » only to take something out of a message, the Board, a team, a group or a project) |
| Take back (a queued message, a link) | Retirer |
| Steer / Steering… / Steered | Réorienter / Réorientation… / Réorienté |
| Take control / Just watch / Stop controlling | Prendre la main / Juste regarder / Rendre la main |
| Update now / Update automatically | Mettre à jour / Mettre à jour automatiquement |
| Keep up to date | Garder à jour |
| Open as document / Export | Ouvrir en document / Exporter |
| Reconnect / Disconnect | Reconnecter / Déconnecter |
| Working / Done / Idle / Asks | Au travail / Terminé / Inactif / Question |
| Stop | Arrêter |
| Saved | Enregistré |
| the web page | le navigateur ("dans le navigateur"), so that "page" stays a Page |
| the Android app / the iPhone app / the desktop app | l'appli Android / l'appli iPhone / l'appli de bureau |
| the owner / you | tu |

## Choices worth knowing

- **Needs you → "Pour toi".** A short heading, the way an app's "For you" tab reads; "Besoin de toi" was longer and sounds like a plea. In a sentence: « dans Pour toi ». A count says « {n} a besoin de toi ».
- **task → "demande", job → "tâche".** French apps call a scheduled job a « tâche planifiée » (Windows, Android), so a run's request is a « demande », what the bot was asked.
- **Asks → "Question"** as a state, so that « demande » stays a task; the verb stays « demande » (« {bot} te demande… », « Demande à installer… »).
- **"Let {bot} {what}?" → « Autoriser {bot} à {what} ? »**, with the permissions as infinitives (« naviguer sur le web », « lancer des commandes »): « à » never elides, so every permission fits.
- **chat → "discussion"**, as WhatsApp and Messenger say it in French; « chat » stays only in "run by chat" on the Play listing, where it means messaging in general.
- **helpers → "assistants"**: short-lived ones inside a run, never a bot (a bot is never an "assistant").
- **standup → "point du matin"**: the French office word for a short morning meeting.
- **Always approved → "Toujours approuvé"**, to match "Toujours approuver" on a job's card; « Toujours autorisé » is the permission's.
- **Steer → "Réorienter"**: what a message sent to a working bot does to its run.
- **Table (a CSV file's view) → "Tableau"**: the file viewer's own word, beside "Source"; the Board is always "Tableau" with a capital T.
