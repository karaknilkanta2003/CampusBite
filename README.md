# CampusBite

Real-time canteen platform for a college campus. Students see which canteens are open, what's on the menu, how crowded each one is, and order ahead into a pickup slot that fits their class break. Kitchens get a live order screen, counters get a pickup board, and admins get the trial metrics.

Built from the CCPD group assignment (Kano → Conjoint → QFD → Lean). Every rule in the brief is implemented and tested; see [How the brief maps to the code](#how-the-brief-maps-to-the-code).

## What's in it

| Screen | Who | URL | What it does |
| --- | --- | --- | --- |
| Student app (installable PWA) | Students, faculty, staff | `/` | Live open/closed status and hours, crowd meter and campus map, live menu with sold-out items, pickup slots with capacity, timetable-aware slot suggestion, UPI payment, order tracker, push alert when ready, per-dish ratings |
| Kitchen display | Canteen staff (tablet) | `/kitchen` | New → Cooking → Ready → Collected, chime on new orders, sold-out toggles, Open / Closed / Hours switch, slot load, code lookup, keeps the screen awake |
| Pickup board | Counter TV, no sign-in | `/board/<canteen>` | Preparing and Ready codes with shelf numbers, sold-out list |
| Admin console | Admins | `/admin` | Trial metrics with keep-going / change-direction thresholds, canteens and opening hours, menus and prices, staff roles, door-counter keys |
| Door counter | Hardware | `POST /api/sensors/occupancy` | Posts the number of people inside; drives the crowd meter. See [docs/door-counter.md](docs/door-counter.md) |

## Quick start, step by step

Checked end to end on a clean clone (Windows 10, Node 24.18). The commands are the same on macOS and Linux; where Windows needs something different it is called out.

### 1. Check the prerequisites

```bash
node --version      # must be v22.18 or newer; v24 recommended
npm --version
```

That is all. No database server to install (it uses the SQLite built into Node), and no Docker unless you deploy.

### 2. Get the code and install

```bash
git clone https://github.com/DigantaSen/Campus-Bite.git campusbite
cd campusbite
npm install
```

`npm install` sets up both workspaces (`server` and `web`) and takes a few minutes the first time.

A `.env` file is **optional** — every setting has a development default. Copy it only when you want to change ports, payments, map tiles or keys:

```bash
cp .env.example .env            # PowerShell: Copy-Item .env.example .env
```

Without it the server prints `../.env not found. Continuing without it.` on startup. That is normal.

### 3. Start it

```bash
npm run dev
```

Web app on <http://localhost:5173>, API on <http://localhost:8080>; both reload as you edit. You should see:

```
[seed] loading IIIT-H canteens and messes, demo staff and two weeks of demo order history
CampusBite running at http://localhost:8080 (port 8080)
  payments: mock · push: off (set VAPID keys) · email: printed to this log
  demo kitchen autopilot: on (canteens with no kitchen screen open run themselves)
```

The `[seed]` line appears only on the first start, when the database is created.

The other ways to start it:

| Command | Serves on | Use it for |
| --- | --- | --- |
| `npm run dev` | :5173 web, :8080 API | Everyday development, hot reload |
| `npm run build && npm start` | :8080 only | A production-like check on one port, no hot reload |
| `npm run dev:lan` | `http://<laptop-ip>:5173` | Phones on the **same** Wi-Fi — see [home Wi-Fi](#run-it-on-your-phone-over-home-wi-fi-same-network) |
| `npm run share` | a public HTTPS link | Phones on **any** network, with a QR code — see [step 5](#5-share-it-with-a-qr-code) |

### 4. Check it manually

**Open each screen.** No real email is needed: the sign-in screen has one-tap demo buttons, and a typed address gets its code filled in automatically.

| Screen | Open | Sign in as |
| --- | --- | --- |
| Student app | <http://localhost:5173/> | tap **Student**, or any `@students.iiit.ac.in` address |
| Kitchen display | <http://localhost:5173/kitchen> | `kitchen.vc@iiit.ac.in` (also `kitchen.bbc`, `kitchen.davids`, `kitchen.jc`, `kitchen.cie`) |
| Pickup board | <http://localhost:5173/board/vc> | no sign-in |
| Admin console | <http://localhost:5173/admin> | `admin@iiit.ac.in` |

**Walk one order through.** This exercises the whole live path in about a minute:

1. On the student app, sign in and pick an open canteen (VC and BBC open early; David's, JC and CIE have shorter hours).
2. Add an item, choose a pickup slot, and pay — the `mock` provider takes no money.
3. Watch the tracker go **Placed → Cooking → Ready**. With no kitchen screen open, the demo autopilot starts cooking 15 s after payment and marks it ready 40 s later.
4. Open `/kitchen/vc` in a second window to take manual control instead, and drive it with **Start cooking** and **Mark ready**. The student page and `/board/vc` update within a second.
5. Collect the order, then rate a dish; the rating shows on the menu and under Admin → Metrics.

Use a normal window and a private window to act as two people on one computer.

**Check the API from the command line.**

```bash
curl http://localhost:8080/api/health      # server is up
curl http://localhost:8080/api/config      # payment provider, fee, allowed domains, map
curl http://localhost:8080/api/canteens    # 8 places: 5 canteens + 3 messes, each with a status
```

Feed the crowd meter the way a door counter does, then reload the student app to see it move:

```bash
curl -X POST http://localhost:8080/api/sensors/occupancy \
  -H "Content-Type: application/json" -H "X-Device-Key: cbdev_demo_vc_counter" \
  -d '{"people": 70}'
# -> {"ok":true}
```

**Run the automated checks.**

```bash
npm test          # 18 tests: order lifecycle, slot capacity, status rules, crowd, mess hours
npm run typecheck # server and web
```

### 5. Share it with a QR code

`npm run dev` only serves `localhost`, so there is no link to put in a QR code. The QR code comes from share mode, which puts the app on a public HTTPS link that any phone can open on any network:

```bash
npm run share
```

It runs three steps — builds the web app, starts the server on :8080, then opens a free tunnel — and prints the link with a QR code:

```
=====================================================================
 CampusBite is online (via Pinggy, renews every 60 minutes). Open this link on any phone, on any network:

   https://xxxxx-1-2-3-4.free.pinggy.net

   ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
   █ ▄▄▄▄▄ ██▄▄ ▀  ██ ▀█ █ ▄▄▄▄▄ █     <- scan this with the phone camera
   █ █   █ █▀▄  ▀▀▄▀ ▀ ▀ █ █   █ █
   ...

   Students:     https://xxxxx-1-2-3-4.free.pinggy.net/
   Kitchen:      https://xxxxx-1-2-3-4.free.pinggy.net/kitchen   (kitchen.bbc@iiit.ac.in)
   Pickup board: https://xxxxx-1-2-3-4.free.pinggy.net/board/bbc
   Admin:        https://xxxxx-1-2-3-4.free.pinggy.net/admin     (admin@iiit.ac.in)
=====================================================================
```

Scan the QR code, or type the link. Give each device one role:

| Device | Open | Sign in as |
| --- | --- | --- |
| Student phone(s) | the link | tap **Student**, or type `friend1@students.iiit.ac.in` to get your own student |
| Kitchen phone or tablet | link + `/kitchen` | `kitchen.bbc@iiit.ac.in` |
| Counter TV or laptop | link + `/board/bbc` | no sign-in |
| Your laptop | link + `/admin` | `admin@iiit.ac.in` |

Because the link is HTTPS, "Near me" location, push alerts (once VAPID keys are set) and Add to Home Screen all work on the phone.

Worth knowing:

- **It tries Cloudflare first and falls back to Pinggy** after about 25 s. Many campus networks block Cloudflare, so skip the wait with `SHARE_VIA=pinggy npm run share` (PowerShell: `$env:SHARE_VIA='pinggy'; npm run share`). Pinggy needs the `ssh` command, which is built into Windows 10/11, macOS and Linux.
- **The free Pinggy link lasts 60 minutes.** The script then opens a new one and prints a new QR code; open the new link on each phone and sign in again.
- **Anyone with the link can open the app**, including the one-tap *Admin* button. Keep it to your group, and stop it when the demo ends. To make kitchen and admin codes appear only in your terminal, use `DEV_CODES=students npm run share`.
- **The laptop must stay on and connected** — the app runs on it.
- **It takes over port 8080**, stopping an older CampusBite server already there. In share mode `localhost:5173` is not used; open `http://localhost:8080` on the laptop.

See [the full college Wi-Fi section](#run-it-on-your-phone-on-college-wi-fi-recommended) for what to do when both tunnels are blocked.

### 6. Stop it

Press **Ctrl+C** in the terminal that is running it. That also closes the public link.

If you lost the terminal and a port is still held:

```powershell
# Windows PowerShell
Get-NetTCPConnection -LocalPort 8080,5173 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

```bash
# macOS / Linux
kill $(lsof -t -i:8080 -i:5173)
```

Your data stays in `server/data/campusbite.db`, so orders and sign-ins are still there next time.

### If something goes wrong

| Symptom | Fix |
| --- | --- |
| `Port 8080 is already in use` | An older server is still running — see [step 6](#6-stop-it). |
| Changed places, hours or menus do not show up | Delete `server/data/` once and restart; demo data is only seeded into a fresh database. |
| Orders cook themselves | That is the demo autopilot. Open `/kitchen/<id>` to take over, or set `DEMO_KITCHEN_AUTOPILOT=false`. |
| No sign-in email arrives | None is sent in development. Tap a demo button, or read the code from the server log (`[email] Sign-in code for …`). |
| `ssh is not recognized` during `npm run share` | Windows: Settings → System → Optional features → add **OpenSSH Client**. |
| No link after two minutes of `npm run share` | The network blocks both tunnels. Put the **laptop** on your phone hotspot and run it again; the phones can stay on college Wi-Fi. |
| Phone cannot open a `dev:lan` address | Same Wi-Fi, firewall allowed, and use the Wi-Fi adapter IPv4 address — see [If the phone can't connect](#if-the-phone-cant-connect). |

## Run it locally

Needs Node.js 22.18 or newer (24 recommended). No database server: it uses the SQLite built into Node.

```bash
cd campusbite
npm install
cp .env.example .env          # optional; every setting has a development default
npm run dev                    # API on :8080, web app on http://localhost:5173
```

Or build once and serve everything from one process:

```bash
npm run build && npm start     # http://localhost:8080
```

On first start it loads IIIT Hyderabad's canteens and messes, demo accounts and two weeks of made-up order history. In development no mail server is needed: the sign-in code is printed in the server log **and** filled in on the sign-in screen.

**Places and map.** VC, BBC, David's Canteen, Juice Canteen (JC) and CIE Canteen take orders. Kadamba, Yuktahar and Palash messes appear on the map with their meal times. Their map positions and opening hours come from [OpenStreetMap](https://www.openstreetmap.org/way/31355320) (read October 2026), and the dishes come from student guides. **Prices are placeholders**, because no price list is published. Before launch, confirm each pin, hours and menu on campus and fix them under Admin → Places, map and hours. Outlets with no map position yet (Tantra, Mandru's Kitchen, Sri Akshaya Food Court) can be added there by pasting coordinates from Google Maps. The map uses OpenStreetMap tiles. For real traffic, set `MAP_TILE_URL` to a tile provider (OpenStreetMap's own servers are for light use).

| Email | Role |
| --- | --- |
| `student@students.iiit.ac.in` | Student (with a sample timetable) |
| `kitchen.vc@iiit.ac.in` | Kitchen staff, Vindhya Canteen (also `kitchen.bbc`, `kitchen.davids`, `kitchen.jc`, `kitchen.cie`) |
| `admin@iiit.ac.in` | Admin |

**Demo kitchen autopilot.** So you can try the student flow alone, any canteen with no kitchen screen open runs itself: it checks in, starts cooking 15 s after payment and marks food ready 40 s later. Open `/kitchen/vc` as kitchen staff and that canteen switches to manual. Set `DEMO_KITCHEN_AUTOPILOT=false` to turn it off (it is always off in production).

Try the door counter:

```bash
curl -X POST http://localhost:8080/api/sensors/occupancy \
  -H "Content-Type: application/json" -H "X-Device-Key: cbdev_demo_vc_counter" \
  -d '{"people": 70}'
```

If you ran an earlier version, delete `server/data/` once so the new places load.

## Run it on your phone on college Wi-Fi (recommended)

College Wi-Fi usually blocks devices from reaching each other ("client isolation"), so a phone cannot open the laptop's address directly, even on the same network. Instead, share the app through a **public HTTPS link**. The laptop makes an outgoing connection to a free tunnel service, and any phone can open the link on **any network**: college Wi-Fi, mobile data or another Wi-Fi. No account is needed.

The script tries a **Cloudflare** tunnel first. Many campus networks block it (it needs outbound port 7844), so after about 25 seconds it switches automatically to **Pinggy**, which runs over normal HTTPS port 443 and works almost everywhere. Pinggy uses the `ssh` command, which is built into Windows 10/11, macOS and Linux.

```bash
cd campusbite
npm install          # first time only; downloads the Cloudflare tunnel program (about 55 MB)
npm run share
```

After about 30–60 seconds the terminal shows the link and a **QR code**:

```
 CampusBite is online (via Pinggy, renews every 60 minutes). Open this link on any phone, on any network:

   https://abcde-1-2-3-4.free.pinggy.net

   Students:     https://abcde-1-2-3-4.free.pinggy.net/
   Kitchen:      https://abcde-1-2-3-4.free.pinggy.net/kitchen   (kitchen.bbc@iiit.ac.in)
   Pickup board: https://abcde-1-2-3-4.free.pinggy.net/board/bbc
   Admin:        https://abcde-1-2-3-4.free.pinggy.net/admin     (admin@iiit.ac.in)
```

Scan the QR code with the phone camera, or type the link. Then use one device per role:

| Device | Open | Sign in as |
| --- | --- | --- |
| Student phone(s) | the link | `student@students.iiit.ac.in`, or any `@students.iiit.ac.in` address |
| Kitchen phone or tablet | link + `/kitchen` | `kitchen.bbc@iiit.ac.in` |
| Counter TV or laptop | link + `/board/bbc` | no sign-in |
| Your laptop | link + `/admin` | `admin@iiit.ac.in` |



**Signing in (no email needed).** None of the demo accounts has a real inbox, so the sign-in screen shows **one-tap buttons**: *Student*, a *kitchen* button for each canteen (BBC, VC, JC, David's, CIE) and *Admin*. Tap one and you're in. To give each phone its own student, type any address ending in `@students.iiit.ac.in` (for example `friend1@students.iiit.ac.in`) and tap *Send code*: the code fills in by itself. Codes are also printed in the laptop terminal as `[email] Sign-in code for …`.

Because the link is public, anyone who has it can also tap *Admin*. That is fine for a demo with made-up data, but keep the link to your group. To make kitchen and admin codes appear only in the laptop terminal, run with `DEV_CODES=students` (PowerShell: `$env:DEV_CODES='students'; npm run share`).

**Because the link is HTTPS**, everything works on the phone, including "Near me" location, "food is ready" alerts (once VAPID keys are set) and Add to Home Screen.

Good to know:

- **The laptop must stay on and connected**; the app runs on it. Closing the terminal or pressing **Ctrl+C** stops sharing.
- **The link changes every time** you run `npm run share`. Send the new one (or show the QR code) each time.
- **Pinggy links last 60 minutes** on the free plan. When one expires, the script opens a new link automatically and prints it with a new QR code; open the new link on each phone (sign-ins carry over only if the link stays the same, so sign in again). Cloudflare links have no time limit.
- **Anyone with the link can open the app** while it runs. Don't post it publicly, and stop it when the demo ends.
- **Choose the tunnel yourself:** `SHARE_VIA=pinggy npm run share` skips the Cloudflare attempt (faster on college Wi-Fi); `SHARE_VIA=cloudflare` uses only Cloudflare. On Windows PowerShell: `$env:SHARE_VIA='pinggy'; npm run share`.
- **If no link appears within two minutes,** the network is blocking both tunnels. Connect the **laptop** to your phone's hotspot or mobile data and run `npm run share` again; the phones can stay on college Wi-Fi.
- **"ssh is not recognized"** on Windows: Settings → System → Optional features → add **OpenSSH Client**.

## Run it on your phone over home Wi-Fi (same network)

On a network that lets devices see each other (home Wi-Fi, a phone hotspot), the phone can open the laptop directly, without a public link. Phones, tablets and other laptops on the **same Wi-Fi** open it in their browser. Nothing is installed on the phone.

**1. Start it in network mode** on the laptop:

```bash
cd campusbite
npm run dev:lan
```

After a few seconds it prints the addresses to open, for example:

```
Open CampusBite on other devices on the same network:
  Students:     http://192.168.1.23:5173/
  Kitchen:      http://192.168.1.23:5173/kitchen
  Pickup board: http://192.168.1.23:5173/board/vc
```

Use the address that starts with `192.168.`, `10.` or `172.16–31.` and belongs to your Wi-Fi adapter. Ignore `172.27.x.x` (that is WSL/Hyper-V, not your Wi-Fi). To check by hand: on Windows run `ipconfig` and read the **IPv4 Address** under *Wireless LAN adapter Wi-Fi*; on macOS run `ipconfig getifaddr en0`.

**2. Allow it through the firewall (Windows, first time only).** When Windows asks whether Node.js may use the network, tick **Private networks** and click **Allow**. If you clicked Cancel, or nothing appeared:

- Make sure your Wi-Fi is marked Private: Settings → Network & internet → Wi-Fi → your network → **Private network**.
- Or open PowerShell **as administrator** and run:

  ```powershell
  New-NetFirewallRule -DisplayName "CampusBite dev" -Direction Inbound -Protocol TCP -LocalPort 5173,8080 -Action Allow -Profile Private
  ```

**3. Open it on the phone.** Connect the phone to the same Wi-Fi, type the printed address (e.g. `http://192.168.1.23:5173/`) into Chrome or Safari, and tap a demo account on the sign-in screen (Student, a canteen kitchen, or Admin). No email is needed.

**4. Use one device per role.** Each device keeps its own sign-in, so you can run the whole flow at once:

| Device | Open | Sign in as |
| --- | --- | --- |
| Student phone(s) | `http://<laptop-ip>:5173/` | `student@students.iiit.ac.in` (or any `@students.iiit.ac.in` address) |
| Kitchen tablet or phone | `http://<laptop-ip>:5173/kitchen` | `kitchen.bbc@iiit.ac.in` (or `kitchen.vc`, `kitchen.davids`, `kitchen.jc`, `kitchen.cie`) |
| Counter TV or laptop | `http://<laptop-ip>:5173/board/bbc` | No sign-in |
| Your laptop | `http://localhost:5173/admin` | `admin@iiit.ac.in` |

Place an order on the phone, and it appears on the kitchen screen within a second, with a chime. Press **Start cooking**, then **Mark ready**, and the phone and the board update together. On one computer, use a normal window and a private/incognito window to be two people at once.

**Add to home screen** (optional): in Chrome, tap ⋮ → *Add to Home screen*; in Safari, tap Share → *Add to Home Screen*. It then opens like an app.

**Without the dev server.** For a faster, production-like build on the same network:

```bash
npm run build && npm start      # then open http://<laptop-ip>:8080/ on the phone
```

### If the phone can't connect

| Symptom | Fix |
| --- | --- |
| Page never loads | Phone and laptop must be on the same Wi-Fi (not mobile data). Check the firewall step above. |
| Loads on the laptop but not the phone | You may be using the wrong IP. Use the Wi-Fi adapter's IPv4 address, not `localhost` or `172.27.x.x`. |
| Works at home, not on college Wi-Fi | Campus networks block devices from reaching each other ("client isolation"). Use `npm run share` instead (see above), or connect the laptop to your phone's **hotspot** and open the laptop's new address on that phone. |
| Address changed | Wi-Fi gives the laptop a new IP sometimes. Run `npm run dev:lan` again and use the new address. |
| "Port 8080 is already in use" | Another CampusBite server is still running. Close it (Ctrl+C in its terminal) and start again. |

### What doesn't work over plain Wi-Fi (`http://`)

Browsers only allow these on `https://` or `localhost`:

- **"Near me"** location and walking times.
- **"Food is ready" push alerts**, and installing as a full app on iPhone.

Everything else works, including live order updates while the order page is open. For those two features, use `npm run share` (its link is HTTPS) or deploy as in [Going live on campus](#going-live-on-campus).

## Tests

```bash
npm test          # domain rules + full order lifecycle against an in-memory database
npm run typecheck # server and web
```

## Architecture

```
 Phones (PWA)    Kitchen tablets    Counter TVs     Door counters (ESP32)
      │                │                 │                  │
      └──── HTTPS: REST + Server-Sent Events (live) ────────┘
                              │
                 Node.js + Express (one process)
     auth · orders · slots · status · crowd · payments · jobs
                              │
                 SQLite (WAL) · Razorpay · Web Push · SMTP
```

* **server/** – TypeScript run directly by Node (type stripping, no build step). Express 5, `node:sqlite`, zod validation.
  * `src/domain/` – the business rules: `status.ts` (open / closed / unconfirmed), `slots.ts` (capacity and suggestions), `crowd.ts`, `orders.ts` (lifecycle, shelves, ETA), `canteens.ts`.
  * `src/routes/` – REST API. `src/events.ts` – live updates. `src/jobs.ts` – payment expiry, pickup reminders, status changes, throughput calibration.
  * `src/payments.ts` – Razorpay orders, checkout signature check, webhook, refunds. `mock` provider for development.
* **web/** – React 19 + Vite. Mobile-first student app, kitchen display, pickup board, admin console. Service worker for push alerts.

Times are stored in UTC and shown in IST. Money is stored in paise.

## How the brief maps to the code

| Brief | Implementation |
| --- | --- |
| Kano Must-Be: accurate open status, live menu (F1, F2) | Status combines hours, the kitchen's manual switch and a heartbeat; sold-out toggles push to every open app within a second |
| QFD H1: status sync P95 ≤ 30 s; no signal 5 min → "unconfirmed" | Live events (sub-second); kitchen tablet heartbeat every 30 s; `rules.heartbeatStaleMs = 5 min` shows "Status unconfirmed" and pauses ordering |
| QFD H2: slot cap = 0.85 × kitchen throughput, recalibrated weekly | `slotCapacity()`; `calibrateThroughput()` re-measures daily from Ready timestamps over the last 7 days |
| QFD H3: ETA within ±3 min | ETA from the queue ahead and kitchen speed; on-time rate (ready within 3 min of slot) on the metrics page |
| QFD H5: pickup alerts, reminder every 2 min | Web Push on Ready, then every 2 minutes (max 5) until collected |
| Conjoint: class-synced slot (RI 32.7%) | Student timetable; `recommendSlot()` skips class time and adds a 5-minute walk |
| Conjoint: ₹5 fee | `ORDER_FEE_RUPEES` (default 5) |
| Norman: affordance / signifier / mapping / feedback / constraint / mental model | Separate order and collect flows; status pills; pickup code = shelf on the board; Placed → Cooking → Ready tracker; sold-out and full slots can't be chosen; cooking start times shown |
| Kano Delighter: item reviews (F6) | One-tap per-dish ratings after collection; averages on the menu and in admin |
| Crowd meter (F5) | Door counter readings when fresh, otherwise the kitchen queue as a proxy |
| Lean: keep-going / change-direction metrics | Admin → Metrics: on-time rate, 7-day reorder rate, volume, ratings, cancellations, with the brief's thresholds |

## Going live on campus

1. **Server.** Any small VM or campus server (1 vCPU, 1 GB RAM is plenty for a few thousand students). `docker compose up -d --build`, with HTTPS from the campus reverse proxy (push alerts and installing the app require HTTPS).
2. **`.env`.** Set `NODE_ENV=production`, a long random `JWT_SECRET`, `PAYMENT_PROVIDER=razorpay` (or `ALLOW_MOCK_PAYMENTS=true` for a free pilot), `PUBLIC_URL`, `ALLOWED_EMAIL_DOMAINS`, `ADMIN_EMAILS`, and `SEED_DEMO=false`.
3. **Email.** Point `SMTP_*` at the college mail relay (or any transactional email service) so sign-in codes are delivered.
4. **Payments.** Create a Razorpay account (the canteen operator or college as merchant), set `PAYMENT_PROVIDER=razorpay`, the key id and secret, and add a webhook to `https://<your-domain>/api/payments/razorpay/webhook` for `payment.captured` and `order.paid` with `RAZORPAY_WEBHOOK_SECRET`. Refunds for cancelled orders go out automatically.
5. **Push alerts.** `npm run vapid --workspace server` and paste both keys into `.env`.
6. **Set up canteens.** Sign in with an `ADMIN_EMAILS` address → Admin: add canteens, hours, menus; under People, make each kitchen's staff "Kitchen staff" for their canteen.
7. **Hardware per canteen.** A tablet on the kitchen pass showing `/kitchen` (add to home screen), a TV or monitor at the counter showing `/board/<id>`, a numbered pickup shelf, and optionally a door counter.
8. **Backups.** The whole state is one SQLite file in the `campusbite-data` volume; back it up nightly (`sqlite3 campusbite.db ".backup backup.db"`).

**Scale.** One Node process with SQLite in WAL mode is sized for a single campus (a few canteens, a few thousand students); load-test it with your expected lunch peak before launch. If you outgrow it, the data layer is small enough to move to PostgreSQL, and the live updates to Redis pub/sub across several processes.

**Privacy.** Only the college email, an optional name, orders, ratings and an optional timetable are stored. Door counters send a head-count only, never images or device identifiers.

## API summary

| Method | Path | Who |
| --- | --- | --- |
| POST | `/api/auth/request-code`, `/api/auth/verify`, `/api/auth/logout` | anyone |
| GET | `/api/canteens`, `/api/canteens/:id`, `/api/canteens/:id/slots`, `/api/board/:id`, `/api/config` | anyone |
| GET | `/api/events[?kitchen=id][&board=id]` | live stream |
| POST / GET | `/api/orders`, `/api/orders/:id`, `/api/orders/:id/pay/{mock,razorpay}`, `/api/orders/:id/cancel`, `/api/orders/:id/reviews` | student |
| GET / PUT / POST | `/api/me/timetable`, `/api/me/push` | student |
| GET / POST / PATCH | `/api/kitchen/:id`, `/heartbeat`, `/status`, `/menu/:item`, `/lookup/:code`, `/api/kitchen/orders/:id/{advance,cancel}` | kitchen staff |
| * | `/api/admin/...` (canteens, hours, menu, users, sensors, metrics) | admin |
| POST | `/api/sensors/occupancy` (`X-Device-Key`) | door counter |
| POST | `/api/payments/razorpay/webhook` | Razorpay |
