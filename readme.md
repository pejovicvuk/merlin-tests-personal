# Virtualizacija u ItemsControl komponenti

## Trenutna implementacija

Virtualizacija u `ItemsControl` komponenti omogućava efikasno prikazivanje velikih lista podataka tako što se renderuju samo elementi koji su trenutno vidljivi u viewport-u. Ovo značajno poboljšava performanse kada radimo sa velikim kolekcijama podataka.

### Ključni elementi implementacije:

- **itemToElementMap**: Mapa koja prati vezu između podataka i njihovih DOM elemenata
- **IntersectionObserver**: Prati kada elementi ulaze ili izlaze iz viewport-a
- **Dinamički padding**: Koristi se za održavanje pravilne veličine scrollbar-a
- **Efikasno renderovanje**: Renderuju se samo elementi koji su trenutno vidljivi
- **Praćenje promena niza**: Reaguje na promene u originalnom nizu podataka

## Trenutni problemi

### Problem sa praznim viewport-om

Glavni problem trenutne implementacije je neadekvatno rukovanje situacijama kada viewport ostane prazan:

1. **Brzo skrolovanje**: Kada korisnik brzo skroluje, IntersectionObserver može propustiti elemente koji brzo prolaze kroz viewport
2. **Prazni ekran**: Ovo rezultira praznim ekranom jer nijedan element nije vidljiv
3. **Višestruki pozivi**: Funkcija `handleEmptyViewport()` se poziva više puta uzastopno
4. **Neprecizna procena pozicije**: Kada je viewport prazan, procena indeksa za renderovanje može biti neprecizna

