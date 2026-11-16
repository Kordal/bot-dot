Zapisane loginy trafiają do publicznych usług tylko przez sprawdzone https
- Zapytanie bota z zapisanym loginem pod publiczny adres idzie teraz tylko przez https, na zwykłym porcie, i sprawdza certyfikat serwera.
- Twoje własne serwery w domu albo w tailnecie działają jak dotąd, także z certyfikatem z podpisem własnym i na innych portach.
- Zapytanie, które tego nie spełnia, jest odrzucane, zanim sekret zostanie wysłany, a bot dowiaduje się dlaczego.
