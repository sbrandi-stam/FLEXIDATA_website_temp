# FLEXIDATA: pacchetto per Claude Design

Pacchetto per generare con Claude Design il sito web bilingue (IT/EN) del progetto FLEXIDATA.

## Contenuto

- `PROMPT_claude_design.md`: prompt completo da incollare in Claude Design.
- `i18n/it.json`, `i18n/en.json`: dizionari delle traduzioni, stessa struttura di chiavi (parità verificata).
- `data/flexidata_mock_data.json`: serie temporali simulate, 3 giorni a passo 15 minuti, in loop continuo.
- `data/*.csv`, `data/flexidata_anteprima_dati.png`: solo per controllo, da non caricare in Claude Design.
- `riferimenti_stile/`: slide di kick-off usate come riferimento visivo (copertina ritagliata senza la fascia loghi).
- `tools/flexidata_genera_dati.py`: rigenera dati e CSV (eseguire dalla radice del pacchetto: `python3 tools/flexidata_genera_dati.py`).
- `tools/i18n_build.py`: sorgente dei dizionari; rigenera `i18n/` e verifica la parità delle chiavi IT/EN.

## Uso in Claude Design

1. Carica `i18n/it.json`, `i18n/en.json`, `data/flexidata_mock_data.json` e le immagini di `riferimenti_stile/`.
2. Incolla il testo di `PROMPT_claude_design.md` a partire dalla riga di separazione.

## Segnaposto da completare

- CUP (`banner.cup` in entrambi i file i18n).
- Logo MASE: verificare le regole d'uso previste dall'Avviso e dall'accordo attuativo.
- Loghi dei partner.
- Quarto nodo: città e posizione (`map.nodes.N4`, `nodi.N4` nei dati).
- Fasi e deliverable della roadmap, contatti.

## Avvertenze

Tutti i dati sono sintetici. Prezzi, intensità carbonica, remunerazione della flessibilità (220 €/MWh) e tolleranza di consegna (90%) sono parametri illustrativi, non esiti di mercato reali. I KPI di progetto sono obiettivi di candidatura, non risultati.
