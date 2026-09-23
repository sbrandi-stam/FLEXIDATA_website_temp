# Prompt per Claude Design: sito web FLEXIDATA

Allegati da caricare insieme a questo prompt: cartella `i18n/` (it.json, en.json), `data/flexidata_mock_data.json`, immagini in `riferimenti_stile/`.

---

Crea il sito web one-page del progetto di ricerca FLEXIDATA in HTML/CSS/JS, responsive, bilingue italiano e inglese. Registro tecnico ma accessibile a stakeholder istituzionali, operatori di rete e operatori ICT. Tono sobrio e credibile, non promozionale.

## LINGUE E I18N (requisito vincolante)

- Nessun testo visibile scritto nel markup o nel codice: ogni stringa (titoli, etichette, tooltip, legende, messaggi, attributi alt e aria-label, title e meta description) proviene dai dizionari allegati `i18n/it.json` e `i18n/en.json`, tramite attributi `data-i18n="chiave.annidata"` (e `data-i18n-attr="aria-label:chiave"` per gli attributi).
- I due file hanno struttura di chiavi identica. Non rinominare le chiavi. Se serve una stringa nuova, aggiungila in entrambi i file con la stessa chiave e segnalala nel riepilogo finale.
- Interpolazione con segnaposto tra graffe: `{n}`, `{min}`, `{pct}`, `{pv}`, `{kwh}`, `{kw}`, `{year}`.
- Selettore lingua IT | EN nell'header. Lingua iniziale: parametro URL `?lang=`, poi scelta salvata, poi lingua del browser, altrimenti italiano. Al cambio lingua aggiorna `<html lang>`, title, meta description e tutti i testi senza ricaricare la pagina e senza interrompere la simulazione in corso.
- Numeri e orari formattati con `Intl.NumberFormat` e `Intl.DateTimeFormat` secondo la lingua attiva (es. 1.234,5 kW in italiano, 1,234.5 kW in inglese; orario 24 h in entrambe).
- Struttura file: `index.html`, `i18n/it.json`, `i18n/en.json`, `data/flexidata_mock_data.json`. Se l'ambiente richiede un file unico, incorpora dizionari e dati in blocchi `<script type="application/json" id="i18n-it">`, `id="i18n-en"`, `id="data"`, mantenendo contenuto e chiavi identici ai file, così da poterli estrarre in seguito.
- I testi visibili che dipendono dai dati si leggono tramite le chiavi presenti nel JSON dei dati: `nota_key` per gli eventi, `meteo_key` e `meteo_giorno_key` per il meteo. Le chiavi delle configurazioni (`stato_attuale`, `fv`, ...) corrispondono a `sim.eff.configs.*`; le chiavi dei nodi (`MI`, `RM`, `NA`, `N4`) a `map.nodes.*`. I campi testuali in italiano presenti nel JSON dei dati non vanno mostrati.

## STILE GRAFICO (coerente con le slide allegate in riferimenti_stile/)

Usa le immagini allegate solo come riferimento stilistico, senza riprenderne i testi.
Due registri:
- Registro "copertina" per hero, obiettivi e footer: sfondo blu notte (circa #0A1C32), bagliori e linee verdi al neon.
- Registro "contenuto" per le sezioni esplicative: sfondo bianco o grigio-azzurro molto chiaro (circa #F1F5F8), titoli in blu notte.
Palette: blu notte #0A1C32; verde accento #10A060; verde profondo #1E7F5C; salvia #88ADA7; ambra solo per eventi di attivazione e allarmi. Titoli in sans-serif geometrico extra-bold (es. Montserrat o Poppins 800), testo in sans leggibile, etichette tecniche e numeri in monospace tabellare.
Motivo ricorrente: piste di circuito stampato che si ramificano e terminano in foglie o radici stilizzate, come divisori di sezione e cornici agli angoli. Icone e illustrazioni line-art isometriche blu notte e verde. Card con angoli arrotondati, bordo blu notte spesso e ombra morbida. Parole chiave evidenziate in verde bold. Tabelle con intestazione verde. Niente stock-photo. I layout devono reggere testi inglesi fino al 20% più lunghi o più corti dell'italiano.

## SEZIONI

1. **Banner istituzionale** (fisso in cima, sopra la nav): [LOGO MASE, segnaposto] e chiavi `banner.*` (finanziamento MASE, Avviso ex art. 4 c. 1 D.M. 386/2023, area strategica, codice MI_FAE_00349, CUP).

2. **Header e hero** (registro copertina): logo testuale FLEXIDATA, navigazione `nav.*`, selettore lingua. Titolo `hero.title`, sottotitolo, due CTA. Visual: animazione di una linea verde luminosa che attraversa una sagoma stilizzata dell'Italia collegando i nodi, come una "dorsale".

3. **Il concetto** (registro contenuto): tre card `concept.c1..c3`. Nessun nome di mercati, gestori di rete o prodotti regolati specifici.

4. **Architettura interattiva**: schema Ingressi, Piattaforma, Uscite con frecce blu notte spesse e flusso dati animato. Blocchi `arch.layers.*` (campo, digital twin, simulatore, orchestratore, piattaforma di aggregazione, gestore di rete) cliccabili, con pannello laterale funzione / ingressi / uscite in monospace. Il segnale di prezzo va disegnato come due frecce distinte (`arch.price_dispatch` verso l'orchestratore, `arch.price_valuation` verso la piattaforma di aggregazione), con nota `arch.price_note`.

5. **Simulatore a due modalità** (cuore del sito)
   - Badge permanente `sim.badge_simulated`.
   - Selettore segmentato `sim.mode_flex` | `sim.mode_eff`. Le due modalità condividono layout ed elementi grafici: grafico temporale principale, pannello KPI a destra, controlli sotto, mappa (sezione 6) sincronizzata. Al cambio cambiano serie, KPI e controlli con transizione animata; il nodo selezionato resta lo stesso.
   - Asse temporale: 3 giorni da 96 intervalli di 15 minuti, etichettati `sim.day` ("Giorno 1/2/3") con il meteo, mai con le date.

   **5A. Flessibilità e mercati** (fonte: `flessibilita.serie`, `flessibilita.eventi`)
   - Live in loop continuo: 1 giorno simulato in circa 2 minuti, velocità 1x/5x/20x, pausa, ricomincia. Al termine del giorno 3 riparte dal giorno 1 senza salti.
   - Nodo Milano: `baseline_kw` tratteggiata, `misurato_pod_kw` piena, leve impilate (`leva_spostamento_spaziale_kw`, `leva_differimento_it_kw`, `leva_climatizzazione_kw`; valori negativi = pre-raffreddamento o rimbalzo, da mostrare sotto lo zero), `richiesta_kw` punteggiata. Nodo Roma: baseline, misurato e `carico_ricevuto_kw`. Napoli e nodo 4: solo `misurato_pod_kw`.
   - `preavviso_attivo` = banda ambra tenue e conto alla rovescia `sim.flex.notice`; `finestra_attiva` = banda ambra piena `sim.flex.window_active`.
   - KPI in tempo reale: energia modulata cumulata nella finestra, `rapporto_consegna` per intervallo (verde se ≥ `meta.tolleranza_consegna_illustrativa`, rosso se sotto), PUE, `intensita_carbonica_g_kwh`, carico IT, prezzo illustrativo.
   - A fine finestra mostra la card dell'evento con `nota_key`, consegna media e intervalli entro tolleranza.
   - Controlli: selettore nodo, attivazione/disattivazione visiva delle leve (solo visualizzazione, i dati restano quelli del file).

   **5B. Efficientamento asset** (fonte: `efficientamento.nodi[nodo]`)
   - Grafico statico sui 3 giorni. Sovrapposizione prima / dopo: prelievo dello stato attuale in grigio, prelievo della configurazione scelta in verde, area FV, carica e scarica dell'accumulo come barre sopra e sotto lo zero, stato di carica su asse secondario, soglia di picco tratteggiata quando presente.
   - Selettore configurazione `sim.eff.configs.*` (4 configurazioni presenti nei dati). Selettore strategia `sim.eff.strategies.*`: autoconsumo e riduzione picchi usano i dati; "fasce" e "riserva" mostrano `sim.eff.strategy_unavailable`.
   - Taglie da `taglia` con la stringa `sim.eff.sizes`.
   - KPI per giorno e totali dai `kpi` già calcolati: prelievo, immissione, produzione FV, autoconsumo e autosufficienza sempre affiancati con tooltip `sim.eff.tooltip.*`, picco, PUE (con tooltip che spiega che non cambia), CO₂, CUE, costo. Mostra la variazione rispetto allo stato attuale.
   - Se `accumulo_inattivo` è true mostra il messaggio `sim.eff.bess_idle`.
   - Pannello avanzato con parametri economici illustrativi modificabili (`sim.eff.econ_*`) e payback calcolato lato client, con nota `sim.eff.econ_note`.

   **5C. Ponte tra le modalità**: in efficientamento, interruttore `sim.eff.bridge_toggle` che apre un riquadro con barra dello stato di carica divisa tra quota autoconsumo e quota riservata alla flessibilità (regolabile), testo `sim.eff.bridge_conflict` e nota `sim.eff.baseline_note`.

6. **Mappa della rete dei nodi**: mappa SVG stilizzata dell'Italia nello stile line-art delle slide, piste di circuito come collegamenti tra i nodi Milano, Roma, Napoli e nodo 4 (posizione da definire: senza coordinate nei dati, mostralo in un riquadro laterale). Solo livello città, nessun indirizzo e nessun nome di operatore di telecomunicazioni; nota `map.note_location`.
   - Modalità flessibilità: stato per nodo `map.state.*`; particelle di carico IT da Milano a Roma secondo `flessibilita.serie.trasferimento_mappa` (intensità proporzionale a `kw_it`), sincronizzate con la live. Tooltip sul trasferimento con `test_spostamento` dell'evento e testi `map.tooltip.*`. Durante l'evento E2 la freccia compare tratteggiata e barrata con esito "scartato".
   - Modalità efficientamento: icone FV e accumulo per nodo proporzionali alle taglie, indicatore qualitativo di producibilità solare `map.eff_legend.solar`, collegamenti attenuati.
   - Click su un nodo = selezione del nodo nel simulatore.

7. **Le leve**: card `levers.items.*` con principio, tempo di risposta, vincoli e badge in base a `scope` (flex, eff, both).

8. **Obiettivi** (registro copertina): contatori animati `objectives.items.*` con avviso `objectives.disclaimer`.

9. **Roadmap**: timeline orizzontale a 18 mesi, indicatore "oggi", fasi e deliverable come segnaposto `roadmap.placeholder`.

10. **Consorzio**: carosello di card nell'ordine MARE Group, STAM, CNIT, Exprivia, Smart Track (`consortium.partners.*`), logo segnaposto, focus in verde bold. Scorrimento automatico lento, pausa all'hover e al focus, frecce e navigazione da tastiera.

11. **Risultati e disseminazione**: griglia `results.categories.*` con stato `results.coming_soon`.

12. **Footer** (registro copertina): ripetizione dei riferimenti `banner.*`, contatti segnaposto, `footer.disclaimer`, `footer.rights`.

## REQUISITI TECNICI

Nessuna dipendenza esterna oltre a eventuali librerie grafiche da CDN. Accessibilità WCAG AA: contrasto (verificare il verde su bianco per il testo), navigazione da tastiera, `prefers-reduced-motion` (animazioni ferme, grafico statico e messaggio `a11y.reduced_motion`). Animazioni con requestAnimationFrame, pausa quando la sezione non è visibile. Alla fine fornisci un breve riepilogo delle chiavi i18n eventualmente aggiunte.
