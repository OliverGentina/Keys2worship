# Keys2Worship – Grobkonzept

## Ziel
Eine Web-App für iPad (und iPhone), mit der man ohne Vorkenntnisse lernt, Akkorde für Lobpreislieder zu spielen. Der Fokus liegt auf flüssigen Akkordwechseln mit möglichst wenig Handbewegung. Die Anbindung an Chara Technics und Planning Center folgt in einem zweiten Schritt.

## Zielgruppe
Anfänger ohne Klaviererfahrung, die Lobpreis begleiten möchten – vor allem mit der rechten Hand (Akkorde) und optional der linken Hand (Grundton).

## Kernfunktionen (Version 1)

### 1. Grafische Klaviatur
- Große, gut lesbare Tastatur, optimiert für das iPad im Querformat
- Zu drückende Tasten farbig markiert, Fingernummern direkt auf den Tasten
- Farbcode pro Finger, durchgängig in der ganzen App
- Vorschau auf den nächsten Akkord und Pfeile, welcher Finger wohin wandert
- Fingernummern gleiten im Takt des Metronoms zur nächsten Taste
- Hinweis „bleibt liegen“ für Töne, die beim Wechsel gleich bleiben

### 2. Intelligente Akkord-Umkehrungen (Voice Leading)
- Für eine Akkordfolge werden automatisch die Umkehrungen mit dem kürzesten Weg berechnet
- Gemeinsame Töne bleiben liegen – mit demselben Finger
- Fingersatz-Regel: große Lücke oben → 1-2-5, große Lücke unten → 1-3-5
- Linke Hand spielt den Grundton bzw. Basston bei Slash-Akkorden

### 3. Metronom
- Tempo einstellbar, Taktarten 4/4, 3/4, 6/8
- Sichtbarer Taktschlag und Klick, Countdown bis zum nächsten Wechsel

### 4. Übungsmodi
- **Wechsel üben:** zwei Akkorde im Wechsel in Schleife
- **Liedmodus:** komplette Akkordfolge mit Metronom
- **Ohne Hilfe:** Markierungen ausblenden, nur Akkordname

### 5. Lieder & Akkordfolgen
- Lieder manuell anlegen (Titel, Tonart, Tempo, Taktart, Teile mit Akkordfolgen)
- Transponieren
- Später: Import aus Chara Technics und Planning Center

## Ausbaustufe 2: Anbindung
- **Planning Center Services API:** Setlisten und Lieder mit Tonart und Arrangement abrufen
- **Chara Technics:** Lieder aus der Liederdatenbank übernehmen
- Automatisches Erzeugen von Übungen für die Lieder des nächsten Gottesdienstes
