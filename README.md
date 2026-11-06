# Keys2Worship

Eine Web-App fürs iPad (und iPhone), mit der man ohne Vorkenntnisse lernt, Lobpreislieder auf dem Klavier zu begleiten. Der Fokus liegt auf **fließenden Akkordwechseln mit möglichst wenig Handbewegung**.

## Was die App kann (v0.4)

- **Planning Center**: Anmeldung (OAuth + PKCE, dieselbe registrierte App wie Ambientpad), nächste Veranstaltung oder beliebigen Plan als Setlist laden, Lieder aus der Datenbank suchen; Tonart, Tempo, Taktart und Akkorde aus „Lyrics & Chords“ (inkl. Transponieren und Umrechnung in deutsche Akkordnamen)
- **Startseite** mit „Setlist aus Planning Center“ und „Zu übende Lieder“ (eigene Liste, „+ Merken“)
- **Einstellungen** wie in Ambientpad: Menü mit Unterseiten (Planning Center, Klaviatur, Metronom & Gleiten, Klang, Notenschrift, Anleitung, App & Speicher)
- **Anleitung** (`anleitung.html`) Schritt für Schritt mit Bildern

- **Echte Tastengröße & Zoom**: 100 % = Tastenbreite eines echten Klaviers (≈ 23,5 mm); der Ausschnitt läuft mit der Hand mit. Zoom nur mit −/+ oder „100 %“ antippen (mehrere Finger auf der Klaviatur sind ein Akkord, kein Zoom). Kleinste Stufe: ganze Klaviatur. Kalibrierung mit einer Bankkarte in den Einstellungen.
- **Hand-Auswahl**: Rechte Hand (Standard, echte Größe), Linke Hand (Grundton, echte Größe) oder Beide (ganze Klaviatur, zoombar)

- **Startbildschirm** wie in der Ambientpad-App: Schriftzug schreibt sich selbst, „Start“ schaltet den Ton frei (iOS braucht einen Tipp; Ton läuft auch bei Lautlos-Schalter), Versionsnummer

- **Übungsansicht** mit großer Klaviatur (iPad quer: C2–E5, iPhone quer: C3–E5)
  - Fingernummern direkt auf den Tasten (1 = Daumen … 5 = kleiner Finger), jeder Finger mit eigener Farbe
  - gestrichelte Kreise zeigen, wo die Finger beim nächsten Akkord landen
  - **gleitende Fingernummern**: im Takt des Metronoms wandern die Zahlen auf die nächste Taste und kommen genau auf der „1“ an
  - Pfeile über der Tastatur und ein Klartext-Hinweis („Daumen: H → A, 2 Tasten nach links“)
  - „bleibt“-Markierung für Töne, die liegen bleiben dürfen
  - linke Hand spielt den Grundton bzw. Basston bei Slash-Akkorden (z. B. D/Fis)
  - Modi: **Liedmodus**, **Wechsel üben** (zwei Akkorde im Wechsel), **Ohne Hilfe**
- **Automatische Umkehrungen (Voice Leading)**: Für jede Akkordfolge wird die Lage mit dem kürzesten Weg gewählt; ein liegender Ton behält seinen Finger.
- **Metronom** auf der Audio-Uhr (präzise, auch auf dem iPad), 4/4, 3/4 und 6/8, Tempo einstellbar
- **Klang**: Klavier oder Rhodes-ähnliches E-Piano (beides im Browser synthetisiert, keine Sounddateien), Tasten antippen spielt den Ton
- **Lied-Editor**: Titel, Tonart, Tempo, Taktart, Teile (Strophe, Refrain …) mit Akkordfolge als Text (`G D Em C`, zwei Takte: `G*2`), Transponieren mit −/+
- **Akkord-Bibliothek**: jeder Akkord in allen drei Lagen mit Fingersatz und Anhören
- Deutsche (H, Fis, B) oder englische (B, F#, Bb) Notenschrift
- **PWA**: lässt sich zum Home-Bildschirm hinzufügen und funktioniert offline; Bildschirm bleibt beim Üben an

Tastatur am iPad: Leertaste = Start/Stopp, Pfeil rechts/links = nächster/vorheriger Akkord.

## Starten

**Online:** https://olivergentina.github.io/Keys2worship/ (GitHub Pages, sobald eingeschaltet)

Lokal: Es gibt keinen Build-Schritt und keine Abhängigkeiten – reines HTML, CSS und JavaScript (ES-Module).

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

Auf dem iPad: Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“. Der Stummschalter bzw. Lautlos-Modus muss aus sein, damit Safari Töne ausgibt.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `js/music.js` | Akkorde lesen (deutsch/englisch), Umkehrungen mit kürzestem Weg, Fingersätze, Transponieren |
| `js/sound.js` | Klavier- und Rhodes-Synthese, Metronom-Klick, Takt-Planung auf der Audio-Uhr |
| `js/keyboard.js` | Klaviatur, Markierungen, Pfeile, gleitende Fingernummern |
| `js/app.js` | Ansichten: Start, Lied-Editor, Übungsansicht, Akkord-Bibliothek, Einstellungen |
| `js/store.js` | Lieder, Setlist und Einstellungen im Browser speichern (localStorage) |
| `js/pco.js` | Planning Center: Anmeldung, Setlists, Liedsuche, Akkord-Charts lesen |
| `js/splash.js` | Startbildschirm, Ton freischalten |
| `anleitung.html` | Anleitung mit Bildschirmfotos (`anleitung/`) |
| `sw.js`, `manifest.webmanifest` | Offline-Fähigkeit und App-Installation |

## Fahrplan

1. ✅ Konzept, Mockups, Prototyp der Übungsansicht
2. Echte Klavier- und Rhodes-Aufnahmen (z. B. Salamander Grand Piano) statt Synthese
3. ✅ Anbindung an **Planning Center Services** (Setlisten, Tonarten, Arrangements, Akkorde)
4. Import aus **Chara Technics** (Liederdatenbank)
5. Rhythmus-Muster (z. B. Achtel-Begleitung), Vierklänge
6. **Mikrofon-Prüfung**: Die App hört zu, ob der Akkord richtig gegriffen ist – mit Warte-Modus (spielt erst weiter, wenn er stimmt)
7. **Kamera-Modus (erweiterte Realität)**: Fingersätze live auf der echten Tastatur im Kamerabild – einmal einmessen (Muster der schwarzen Tasten), dann Overlay; Frontkamera mit Spiegel-Aufsatz (z. B. Osmo Reflector 2021) oder iPhone an einer Klemmhalterung. Später Handerkennung, um den richtigen Finger zu prüfen.
   - Hinweis: Web MIDI gibt es in Safari/iOS nicht, LiDAR ist aus dem Browser nicht erreichbar – beides ginge nur mit einer nativen App.

Mehr dazu in [docs/konzept.md](docs/konzept.md).

## Planning Center einrichten (einmalig)

Keys2Worship nutzt dieselbe bei Planning Center registrierte App wie Ambientpad (Client-ID in `js/pco.js`). Dort muss unter **Callback URLs** zusätzlich stehen:

```
https://olivergentina.github.io/Keys2worship/
```
