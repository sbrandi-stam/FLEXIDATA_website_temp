import json, math, csv, os
import numpy as np

rng = np.random.default_rng(42)
DT = 0.25                       # h (15 min)
N_DAY = 96
DAYS = 3
N = N_DAY * DAYS
DATES = ["2026-06-15", "2026-06-16", "2026-06-17"]
ts = [f"{DATES[i // N_DAY]}T{(i % N_DAY) // 4:02d}:{(i % 4) * 15:02d}" for i in range(N)]
hod = np.array([(i % N_DAY) * DT for i in range(N)])     # ora del giorno
day = np.array([i // N_DAY for i in range(N)])

def smooth_noise(sd, corr=8):
    """Rumore periodico sul ciclo di 3 giorni (loop senza salto)."""
    w = rng.normal(0, 1, N)
    k = np.exp(-np.arange(-3 * corr, 3 * corr + 1) ** 2 / (2 * corr ** 2)); k /= k.sum()
    ext = np.concatenate([w[-3 * corr:], w, w[:3 * corr]])
    s = np.convolve(ext, k, mode="same")[3 * corr:-3 * corr]
    return s / s.std() * sd

# ---------------- METEO (giugno, 3 giornate) ----------------
WEATHER = ["sereno", "variabile", "coperto"]
CLOUD = {0: 0.05, 1: 0.45, 2: 0.80}   # indice di copertura medio per giorno

NODES = {
    "MI": dict(label="Nodo edge Milano", city="Milano", lat=45.46, lon=9.19,
               it_kw=180, tmin=21, tmax=31, pv_kwp=120, pv_yield=1.00, bess_kwh=200, bess_kw=100),
    "RM": dict(label="Nodo edge Roma", city="Roma", lat=41.90, lon=12.50,
               it_kw=140, tmin=20, tmax=32, pv_kwp=150, pv_yield=1.10, bess_kwh=200, bess_kw=100),
    "NA": dict(label="Nodo edge Napoli", city="Napoli", lat=40.85, lon=14.27,
               it_kw=110, tmin=21, tmax=30, pv_kwp=250, pv_yield=1.15, bess_kwh=300, bess_kw=120),
    "N4": dict(label="Nodo edge 4 [DA DEFINIRE]", city="[DA DEFINIRE]", lat=None, lon=None,
               it_kw=90, tmin=20, tmax=29, pv_kwp=80, pv_yield=1.05, bess_kwh=100, bess_kw=50),
}

def temperature(n):
    p = NODES[n]
    base = (p["tmin"] + p["tmax"]) / 2 + (p["tmax"] - p["tmin"]) / 2 * np.cos(2 * np.pi * (hod - 15) / 24)
    base -= np.array([0, 1.0, 2.5])[day]            # giornate piu' fresche con nuvole
    return base + smooth_noise(0.4)

def base_site(n):
    p = NODES[n]
    it = p["it_kw"] * (1 + 0.06 * np.sin(2 * np.pi * (hod - 8) / 24)) + smooth_noise(p["it_kw"] * 0.01)
    t = temperature(n)
    cop_load = 0.28 + 0.012 * np.clip(t - 18, 0, None)   # quota climatizzazione su IT
    hvac = it * cop_load
    aux = 0.04 * p["it_kw"] * np.ones(N)
    return it, hvac, aux, t

def pv_profile(n):
    p = NODES[n]
    clear = np.clip(np.sin(np.pi * (hod - 5.5) / 15), 0, None) ** 1.3   # alba ~5:30, tramonto ~20:30
    cl = np.array([CLOUD[d] for d in day])
    flicker = np.clip(1 - cl * (0.7 + 0.5 * np.abs(smooth_noise(1, corr=2))), 0.05, 1)
    return p["pv_kwp"] * 0.82 * p["pv_yield"] * clear * flicker     # kW AC

# Prezzi e fattori di emissione illustrativi (non dati reali)
def price(n):
    shape = 110 + 35 * np.exp(-((hod - 20) ** 2) / 4) + 15 * np.exp(-((hod - 8.5) ** 2) / 2) \
            - 40 * np.exp(-((hod - 13.5) ** 2) / 6) * np.array([1.0, 0.6, 0.2])[day]
    off = {"MI": 0, "RM": -4, "NA": -6, "N4": -2}[n]
    return np.round(shape + off + smooth_noise(2), 1)

EF = np.round(300 - 110 * np.exp(-((hod - 13) ** 2) / 10) * np.array([1.0, 0.7, 0.35])[day] + smooth_noise(6), 0)  # gCO2/kWh

r1 = lambda a: [round(float(x), 1) for x in a]
r3 = lambda a: [round(float(x), 3) for x in a]

site = {n: dict(zip(["it", "hvac", "aux", "t"], base_site(n))) for n in NODES}
for n in NODES:
    site[n]["pue"] = (site[n]["it"] + site[n]["hvac"] + site[n]["aux"]) / site[n]["it"]
    site[n]["load"] = site[n]["it"] + site[n]["hvac"] + site[n]["aux"]
    site[n]["price"] = price(n)
    site[n]["pv"] = pv_profile(n)

def idx(d, hh, mm):
    return d * N_DAY + int(hh * 4 + mm / 15)

# =============== SCENARIO A: FLESSIBILITA' (stato attuale, senza FV/accumulo) ===============
# Evento: il nodo sorgente Milano riceve richieste di riduzione; Roma e' il nodo ricevente candidato.
TOL = 0.90
FLEX_REWARD = 220.0  # EUR/MWh remunerazione illustrativa dell'energia modulata al nodo sorgente
EVENTS = [
    dict(id="E1", day=0, start=(18, 0), end=(19, 30), notice=(14, 0), req_kw=45, spatial=True,
         note="Spostamento spaziale accettato: saldo economico positivo, latenza e capacita' a Roma entro i vincoli."),
    dict(id="E2", day=1, start=(8, 30), end=(9, 30), notice=(6, 30), req_kw=55, spatial=False,
         note="Spostamento spaziale scartato: capacita' IT disponibile a Roma insufficiente nella finestra e saldo negativo. Solo leve locali, consegna parziale."),
    dict(id="E3", day=2, start=(17, 30), end=(19, 30), notice=(13, 0), req_kw=60, spatial=True,
         note="Spostamento spaziale accettato, combinato con differimento batch e climatizzazione."),
]

src, dst = "MI", "RM"
base_src = site[src]["load"].copy()
base_dst = site[dst]["load"].copy()
spat_it = np.zeros(N)       # kW IT spostati MI->RM
temp_it = np.zeros(N)       # kW IT differiti (positivo = riduzione)
hvac_mod = np.zeros(N)      # kW climatizzazione (positivo = riduzione)
req = np.zeros(N); win = np.zeros(N, dtype=int); notice_flag = np.zeros(N, dtype=int)
event_id = [""] * N
events_out = []

for e in EVENTS:
    a, b = idx(e["day"], *e["start"]), idx(e["day"], *e["end"])
    nt = idx(e["day"], *e["notice"])
    L = b - a
    req[a:b] = e["req_kw"]; win[a:b] = 1; notice_flag[nt:a] = 1
    for k in range(nt, b): event_id[k] = e["id"]
    pue_s = site[src]["pue"][a:b].mean(); pue_d = site[dst]["pue"][a:b].mean()
    if e["spatial"]:
        sp = 0.55 * e["req_kw"] / pue_s                 # quota IT spostata
        ramp = np.ones(L); ramp[0] = 0.6
        spat_it[a:b] = sp * ramp
        tp = 0.20 * e["req_kw"] / pue_s
    else:
        tp = 0.35 * e["req_kw"] / pue_s
    temp_it[a:b] = tp
    # rimbalzo del differimento nelle 2 ore successive, stessa energia
    Eshift = tp * L
    rb = np.arange(b, min(b + 8, N)); temp_it[rb] -= Eshift / len(rb) * np.linspace(1.4, 0.6, len(rb))
    # climatizzazione: pre-raffreddamento 45', riduzione nella finestra, rimbalzo 1h
    hv = 0.25 * e["req_kw"] if e["spatial"] else 0.33 * e["req_kw"]
    hvac_mod[a:b] = hv * np.linspace(1, 0.7, L)
    hvac_mod[a - 3:a] -= 0.5 * hv
    hvac_mod[b:b + 4] -= hv * L * 0.35 / 4

# Il carico IT spostato viaggia con il PUE del nodo di destinazione
meas_src = base_src - (spat_it + temp_it) * site[src]["pue"] - hvac_mod + smooth_noise(1.2, corr=2)
meas_dst = base_dst + spat_it * site[dst]["pue"] + smooth_noise(1.0, corr=2)
flex_src = base_src - meas_src
ratio = np.where(req > 0, flex_src / np.where(req > 0, req, 1), np.nan)

for e in EVENTS:
    a, b = idx(e["day"], *e["start"]), idx(e["day"], *e["end"])
    E_red = flex_src[a:b].sum() * DT / 1000                # MWh
    E_sp_src = (spat_it[a:b] * site[src]["pue"][a:b]).sum() * DT / 1000
    E_sp_dst = (spat_it[a:b] * site[dst]["pue"][a:b]).sum() * DT / 1000
    p_s = site[src]["price"][a:b].mean(); p_d = site[dst]["price"][a:b].mean()
    if e["spatial"]:
        saldo = E_sp_src * (p_s + FLEX_REWARD) - E_sp_dst * p_d
        cand_src, cand_dst = E_sp_src, E_sp_dst
    else:  # valutazione del trasferimento ipotetico poi scartato
        hyp = 0.55 * e["req_kw"] / site[src]["pue"][a:b].mean()
        cand_src = hyp * site[src]["pue"][a:b].mean() * (b - a) * DT / 1000
        cand_dst = hyp * (site[dst]["pue"][a:b].mean() + 0.25) * (b - a) * DT / 1000  # overflow su risorse meno efficienti
        p_d_eff = p_d + 260   # prezzo effettivo: capacita' satura a Roma, ricorso a risorse di backup
        saldo = cand_src * (p_s + FLEX_REWARD) - cand_dst * p_d_eff
    inside = ratio[a:b]
    events_out.append(dict(
        id=e["id"], nodo_sorgente=src, nodo_destinazione=dst if e["spatial"] else None,
        notifica=ts[idx(e["day"], *e["notice"])], inizio=ts[a], fine=ts[b], intervalli=b - a,
        richiesta_kw=e["req_kw"], spostamento_spaziale_accettato=e["spatial"],
        energia_modulata_mwh=round(E_red, 4),
        consegna_media=round(float(np.mean(inside)), 3),
        intervalli_entro_tolleranza=int((inside >= TOL).sum()),
        test_spostamento=dict(
            energia_evitata_sorgente_mwh=round(cand_src, 4), energia_aggiuntiva_destinazione_mwh=round(cand_dst, 4),
            prezzo_sorgente_eur_mwh=round(float(p_s), 1),
            prezzo_destinazione_eur_mwh=round(float(p_d if e["spatial"] else p_d + 260), 1),
            remunerazione_flessibilita_eur_mwh=FLEX_REWARD,
            saldo_eur=round(float(saldo), 2), esito="accettato" if saldo > 0 and e["spatial"] else "scartato"),
        nota=e["note"], nota_key=f"flex.events.{e['id']}.note"))

flex_series = dict(
    timestamp=ts,
    finestra_attiva=win.tolist(), preavviso_attivo=notice_flag.tolist(), evento=event_id,
    richiesta_kw=r1(req),
    MI=dict(baseline_kw=r1(base_src), misurato_pod_kw=r1(meas_src), flessibilita_kw=r1(flex_src),
            leva_spostamento_spaziale_kw=r1(spat_it * site[src]["pue"]),
            leva_differimento_it_kw=r1(temp_it * site[src]["pue"]),
            leva_climatizzazione_kw=r1(hvac_mod),
            rapporto_consegna=[None if np.isnan(x) else round(float(x), 3) for x in ratio],
            carico_it_kw=r1(site[src]["it"] - spat_it - temp_it), pue=r3(site[src]["pue"]),
            temperatura_c=r1(site[src]["t"]), prezzo_eur_mwh=r1(site[src]["price"])),
    RM=dict(baseline_kw=r1(base_dst), misurato_pod_kw=r1(meas_dst),
            carico_ricevuto_kw=r1(spat_it * site[dst]["pue"]),
            carico_it_kw=r1(site[dst]["it"] + spat_it), pue=r3(site[dst]["pue"]),
            temperatura_c=r1(site[dst]["t"]), prezzo_eur_mwh=r1(site[dst]["price"])),
    NA=dict(misurato_pod_kw=r1(site["NA"]["load"] + smooth_noise(0.8, 2)), pue=r3(site["NA"]["pue"])),
    N4=dict(misurato_pod_kw=r1(site["N4"]["load"] + smooth_noise(0.6, 2)), pue=r3(site["N4"]["pue"])),
    trasferimento_mappa=[dict(t=ts[k], da=src, a=dst, kw_it=round(float(spat_it[k]), 1))
                         for k in range(N) if spat_it[k] > 0],
    intensita_carbonica_g_kwh=[int(x) for x in EF],
)

# =============== SCENARIO B: EFFICIENTAMENTO (FV + accumulo) ===============
ETA = 0.92  # rendimento di carica e scarica (round-trip ~0.85)

def run_bess(load, pv, kwh, kw, strategy):
    soc_min, soc_max = 0.1 * kwh, 0.9 * kwh
    net0 = load - pv
    thr = float(np.percentile(net0, 90)) if strategy == "riduzione_picchi" else None
    def sim(soc0):
        soc = soc0; ch = np.zeros(N); dis = np.zeros(N); socs = np.zeros(N)
        for k in range(N):
            net = net0[k]; c = d = 0.0
            if strategy == "autoconsumo":
                if net < 0: c = min(-net, kw, (soc_max - soc) / (ETA * DT))
                else:       d = min(net, kw, (soc - soc_min) * ETA / DT)
            else:
                if net > thr: d = min(net - thr, kw, (soc - soc_min) * ETA / DT)
                elif net < thr - 15: c = min(thr - 15 - net, kw, (soc_max - soc) / (ETA * DT))
            soc += (c * ETA - d / ETA) * DT
            ch[k], dis[k], socs[k] = c, d, soc
        return ch, dis, socs
    # SoC iniziale = SoC finale (loop continuo): due passate
    soc0 = soc_min if strategy == "autoconsumo" else 0.5 * kwh
    for _ in range(3):
        ch, dis, socs = sim(soc0); soc0 = float(np.clip(socs[-1], soc_min, soc_max))
    return ch, dis, socs, thr

def kpis(load, pv, grid_imp, grid_exp, it, price_, n):
    out = []
    for d in range(DAYS):
        s = slice(d * N_DAY, (d + 1) * N_DAY)
        E_load = load[s].sum() * DT; E_pv = pv[s].sum() * DT
        E_imp = grid_imp[s].sum() * DT; E_exp = grid_exp[s].sum() * DT
        E_it = it[s].sum() * DT
        pv_self = max(E_pv - E_exp, 0)
        co2 = (grid_imp[s] * EF[s]).sum() * DT / 1000     # kgCO2
        out.append(dict(giorno=DATES[d], giorno_n=d + 1, meteo=WEATHER[d], meteo_key=f"sim.weather.{WEATHER[d]}",
            energia_prelevata_kwh=round(E_imp, 1), energia_immessa_kwh=round(E_exp, 1),
            produzione_fv_kwh=round(E_pv, 1),
            autoconsumo=round(pv_self / E_pv, 3) if E_pv > 0 else None,
            autosufficienza=round((E_load - E_imp) / E_load, 3),
            picco_prelievo_kw=round(float(grid_imp[s].max()), 1),
            pue_medio=round(E_load / E_it, 3),
            co2_kg=round(co2, 1), cue_kgco2_kwh_it=round(co2 / E_it, 4),
            costo_energia_eur=round(float((grid_imp[s] * price_[s]).sum() * DT / 1000), 2)))
    return out

eff = dict(timestamp=ts, meteo_giorno=WEATHER, meteo_giorno_key=[f"sim.weather.{w}" for w in WEATHER], intensita_carbonica_g_kwh=[int(x) for x in EF], nodi={})
for n, p in NODES.items():
    load, it, pv, pr = site[n]["load"], site[n]["it"], site[n]["pv"], site[n]["price"]
    cfgs = {}
    # stato attuale
    cfgs["stato_attuale"] = dict(prelievo_kw=r1(load), immissione_kw=r1(np.zeros(N)),
                                 kpi=kpis(load, 0 * pv, load, 0 * load, it, pr, n))
    # + FV
    net = load - pv
    imp, exp_ = np.clip(net, 0, None), np.clip(-net, 0, None)
    cfgs["fv"] = dict(fv_kw=r1(pv), prelievo_kw=r1(imp), immissione_kw=r1(exp_),
                      kpi=kpis(load, pv, imp, exp_, it, pr, n))
    for strat in ["autoconsumo", "riduzione_picchi"]:
        ch, dis, soc, thr = run_bess(load, pv, p["bess_kwh"], p["bess_kw"], strat)
        net = load - pv + ch - dis
        imp, exp_ = np.clip(net, 0, None), np.clip(-net, 0, None)
        cfgs[f"fv_accumulo_{strat}"] = dict(
            fv_kw=r1(pv), carica_kw=r1(ch), scarica_kw=r1(dis),
            soc_pct=r1(soc / p["bess_kwh"] * 100),
            prelievo_kw=r1(imp), immissione_kw=r1(exp_),
            soglia_picco_kw=None if thr is None else round(float(thr), 1),
            accumulo_inattivo=bool(dis.sum() * DT < 0.02 * p["bess_kwh"] * DAYS),
            kpi=kpis(load, pv, imp, exp_, it, pr, n))
    eff["nodi"][n] = dict(
        carico_totale_kw=r1(load), carico_it_kw=r1(it), climatizzazione_kw=r1(site[n]["hvac"]),
        temperatura_c=r1(site[n]["t"]), prezzo_eur_mwh=r1(pr),
        taglia=dict(fv_kwp=p["pv_kwp"], accumulo_kwh=p["bess_kwh"], accumulo_kw=p["bess_kw"]),
        configurazioni=cfgs)

data = dict(
    meta=dict(
        titolo="FLEXIDATA - dati simulati per mockup sito web",
        i18n="i testi visibili vanno presi dai file i18n tramite le chiavi *_key; i campi testuali in italiano nel JSON sono solo di controllo",
        avviso="Dati sintetici a scopo illustrativo. Non rappresentano misure reali, siti reali o prodotti di mercato specifici.",
        passo_minuti=15, giorni=DATES, intervalli=N, loop="i 3 giorni sono pensati per ripetersi in ciclo continuo (rumore periodico, nessun salto a mezzanotte del giorno 3)",
        unita=dict(potenza="kW", energia="kWh o MWh come indicato", prezzo="EUR/MWh illustrativo", intensita_carbonica="gCO2/kWh illustrativo"),
        tolleranza_consegna_illustrativa=TOL,
        rendimento_accumulo_carica_scarica=ETA,
        convenzioni=[
            "flessibilita_kw = baseline_kw - misurato_pod_kw (positivo = riduzione del prelievo al POD)",
            "le leve del nodo sorgente sono espresse in kW al POD; il carico IT spostato e' moltiplicato per il PUE del nodo che lo esegue",
            "valori negativi delle leve = pre-raffreddamento o rimbalzo del carico differito",
            "autoconsumo = FV consumata in sito / FV prodotta; autosufficienza = fabbisogno coperto localmente / fabbisogno totale",
            "il PUE non cambia installando FV o accumulo: migliora la CUE, non il PUE",
            "nella modalita' flessibilita' i nodi sono nello stato attuale (senza FV e accumulo)"]),
    nodi={n: dict(label=p["label"], citta=p["city"], lat=p["lat"], lon=p["lon"], it_nominale_kw=p["it_kw"]) for n, p in NODES.items()},
    flessibilita=dict(eventi=events_out, serie=flex_series),
    efficientamento=eff)

out = "./data"
os.makedirs(out, exist_ok=True)
with open(f"{out}/flexidata_mock_data.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

# CSV di controllo
with open(f"{out}/flexidata_flessibilita.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f, delimiter=";")
    S = flex_series
    w.writerow(["timestamp", "evento", "preavviso", "finestra", "richiesta_kw", "MI_baseline_kw", "MI_pod_kw", "MI_flex_kw",
                "MI_leva_spaziale_kw", "MI_leva_differimento_kw", "MI_leva_clima_kw", "MI_rapporto", "RM_baseline_kw", "RM_pod_kw", "RM_ricevuto_kw", "NA_pod_kw", "N4_pod_kw"])
    for k in range(N):
        w.writerow([ts[k], S["evento"][k], S["preavviso_attivo"][k], S["finestra_attiva"][k], S["richiesta_kw"][k],
                    S["MI"]["baseline_kw"][k], S["MI"]["misurato_pod_kw"][k], S["MI"]["flessibilita_kw"][k],
                    S["MI"]["leva_spostamento_spaziale_kw"][k], S["MI"]["leva_differimento_it_kw"][k], S["MI"]["leva_climatizzazione_kw"][k],
                    S["MI"]["rapporto_consegna"][k], S["RM"]["baseline_kw"][k], S["RM"]["misurato_pod_kw"][k], S["RM"]["carico_ricevuto_kw"][k],
                    S["NA"]["misurato_pod_kw"][k], S["N4"]["misurato_pod_kw"][k]])
with open(f"{out}/flexidata_efficientamento.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f, delimiter=";")
    hdr = ["timestamp", "nodo", "carico_kw", "fv_kw"]
    for c in ["stato_attuale", "fv", "fv_accumulo_autoconsumo", "fv_accumulo_riduzione_picchi"]:
        hdr += [f"{c}_prelievo_kw", f"{c}_immissione_kw"]
    hdr += ["auto_soc_pct", "picchi_soc_pct"]
    w.writerow(hdr)
    for n in NODES:
        C = eff["nodi"][n]["configurazioni"]
        for k in range(N):
            row = [ts[k], n, eff["nodi"][n]["carico_totale_kw"][k], C["fv"]["fv_kw"][k]]
            for c in ["stato_attuale", "fv", "fv_accumulo_autoconsumo", "fv_accumulo_riduzione_picchi"]:
                row += [C[c]["prelievo_kw"][k], C[c]["immissione_kw"][k]]
            row += [C["fv_accumulo_autoconsumo"]["soc_pct"][k], C["fv_accumulo_riduzione_picchi"]["soc_pct"][k]]
            w.writerow(row)

print(json.dumps(events_out, ensure_ascii=False, indent=1))
for n in NODES:
    for c, v in eff["nodi"][n]["configurazioni"].items():
        k = v["kpi"]
        print(n, c, [ (x["energia_prelevata_kwh"], x["autoconsumo"], x["autosufficienza"], x["picco_prelievo_kw"], x["cue_kgco2_kwh_it"]) for x in k], v.get("accumulo_inattivo"))
print(os.path.getsize(f"{out}/flexidata_mock_data.json"))
