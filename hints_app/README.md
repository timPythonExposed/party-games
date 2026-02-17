# Hints – Woordenspel

Single-player webapp waarin je woorden moet raden uit zelfgekozen categorieën, met timer.

## Vereisten

- Python 3.11+
- pip

## Installatie

```bash
pip install -r hints_app/requirements.txt
```

## Starten

Draai vanuit de project-root (de map die `hints_app/` en `data/` bevat):

```bash
uvicorn hints_app.app:app --reload
```

Open vervolgens [http://localhost:8000](http://localhost:8000) in je browser.

## Data

Woorden worden geladen uit `data/lijsten/hints.json`. Dit bestand moet in de opgegeven mapstructuur staan ten opzichte van de `hints_app/` map. Het verwachte schema:

```json
{
  "categories": {
    "<naam>": {
      "difficulty": "easy|medium|hard",
      "items": ["woord1", "woord2"]
    }
  }
}
```

## Tests

```bash
python -m pytest hints_app/tests/ -v
```

## Functionaliteit

- Kies één of meer categorieën (of "Alle")
- Druk op "Volgend woord" voor een nieuw woord (geen herhalingen binnen een sessie)
- Timer met visuele voortgang (15/30/45/60/90 seconden instelbaar)
- Licht/donker/systeem thema
- Instelbare tekstgrootte
- Mobiel: schud je telefoon voor het volgende woord
- Dubbelklik op het woord voor fullscreen

## Bekende limieten

- Sessies worden in-memory opgeslagen en gaan verloren bij herstart van de server
- Geen persistente opslag; bedoeld voor lokaal/casual gebruik
- Rate-limit van 10 verzoeken per minuut per sessie op /next
