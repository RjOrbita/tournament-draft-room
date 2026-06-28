# 🏆 Tournament Draft Room

> A real-time, browser-based **blind-bid draft platform** for tournaments. Admins create rooms, load a player pool, and captains fight for players through **sealed blind auctions** — all revealed simultaneously.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Firebase](https://img.shields.io/badge/Firebase-Realtime%20DB-orange?logo=firebase)
![HTML](https://img.shields.io/badge/Built%20with-HTML%2FCSs%2FJS-informational)

---

## 🎬 How It Works

```
Admin creates room → Sets up player pool → Invites captains via 6-character code
         ↓
Captain's turn → Picks a player from the pool → Sets a sealed blind bid
         ↓
All other captains place their own sealed blind bids (or pass)
         ↓
All bids are revealed simultaneously 🎲
         ↓
Highest bid wins the player — points deducted from winner's bank
         ↓
Next captain's turn → repeat until all rosters are full
```

---

## ✨ Features

| Feature | Details |
|---|---|
| 🎲 **Blind Bid Auctions** | Every captain bids secretly — all revealed at once with a card-flip animation |
| ⚡ **Real-time Sync** | Firebase Realtime Database keeps all browsers in sync instantly |
| ⏸️ **Pause on Disconnect** | Timer freezes if a captain who hasn't bid yet drops connection, resumes on reconnect |
| 👑 **Admin Controls** | Create rooms, manage player pool, assign captains, control draft order |
| 📋 **CSV Import** | Bulk-load your player pool from a spreadsheet |
| 👥 **Spectator Mode** | Observers can join and watch the live draft without participating |
| 🔄 **Drag-to-Reorder** | Set draft turn order in the lobby via drag-and-drop |
| 🏅 **Results & Export** | Final rosters with podium view and CSV export |
| 📱 **Responsive** | Works on desktop and mobile |

---

## 🖥️ Screenshots

| Landing | Setup Wizard | Draft Room |
|---|---|---|
| Create or join rooms | 3-step room configuration | Live blind bid action |

---

## 🚀 Quick Start

### Prerequisites
- A free [Firebase](https://console.firebase.google.com) project
- A local HTTP server (VS Code Live Server, Python, or Node)

### 1. Clone the repo
```bash
git clone https://github.com/RjOrbita/tournament-draft-room.git
cd tournament-draft-room
```

### 2. Configure Firebase
```bash
cp js/firebase-init.example.js js/firebase-init.js
```
Open `js/firebase-init.js` and fill in your Firebase project values.  
Find them at: **Firebase Console → ⚙️ Project Settings → Your apps → Web**

### 3. Set up Firebase services
In your Firebase project:
- **Authentication** → Sign-in method → Enable **Anonymous**
- **Realtime Database** → Create Database → Start in test mode
- **Realtime Database** → Rules → Paste contents of `database.rules.json` → Publish

### 4. Run locally
```bash
# Python
python -m http.server 3000

# Node
npx serve . --listen 3000
```
Open **http://localhost:3000**

---

## 🎮 How to Play

### Admin
1. Click **Create Room** → Enter your name
2. Configure: room name, number of captains, team size per captain, starting points, bid timer
3. Add players (manually or via CSV import)
4. Share the **6-character invite code** with participants
5. In the lobby, assign captain roles to joined participants
6. Optionally drag to reorder the draft turn order
7. Click **Start Draft**

### Captain
1. Click **Join Room** → Enter invite code + your name
2. Wait in lobby for admin to assign you as a captain
3. **On your turn**: Click a player → set your sealed bid → lock in
4. **Other turns**: Place your blind bid on the nominated player, or pass
5. Bids reveal → highest wins → points deducted → next turn

### Spectator
- Join with any invite code and watch the draft live

---

## 📐 Draft Rules

| Rule | Detail |
|---|---|
| Starting points | Configurable per event (default: 100) |
| Minimum bid | 1 point |
| Bid type | Blind (sealed) — no counter-bidding |
| Tie-breaker | Nominating captain wins ties |
| Draft ends | When all captain rosters reach the configured team size |
| Reconnect | Timer pauses for disconnected captains who haven't bid |

---

## 📁 Project Structure

```
tournament-draft-room/
├── index.html              # Landing page — create or join
├── admin-setup.html        # 3-step room creation wizard
├── lobby.html              # Waiting room & captain assignment
├── draft.html              # Live draft room (3-column layout)
├── results.html            # Final rosters, podium & CSV export
├── css/
│   └── styles.css          # Full design system (dark theme)
├── js/
│   ├── firebase-init.example.js  ← copy to firebase-init.js & fill in config
│   ├── utils.js            # Shared helpers (toast, CSV parser, presence)
│   ├── index.js            # Landing page logic
│   ├── admin-setup.js      # Room wizard logic
│   ├── lobby.js            # Lobby & captain assignment
│   ├── draft.js            # Core draft engine & blind bid state machine
│   └── results.js          # Results & export
└── database.rules.json     # Firebase security rules
```

---

## 🔒 Security

The app uses **Firebase Anonymous Authentication** — every browser session gets a unique secure token without requiring login. The database rules enforce:

- Only signed-in users can read room data
- Only the room's original admin can modify settings or the player pool
- Participants can only write to their own records
- The database root is completely blocked to unauthenticated requests

---

## 📄 CSV Import Format

```csv
Name,Position,Info
John Doe,Forward,22 goals last season
Jane Smith,Midfielder,Team captain, strong passer
Bob Johnson,Goalkeeper,Clean sheet specialist
```
`Position` and `Info` columns are optional.

---

## 🛠️ Tech Stack

- **Frontend**: Vanilla HTML, CSS, JavaScript (no framework, no build step)
- **Backend**: Firebase Realtime Database
- **Auth**: Firebase Anonymous Authentication
- **Fonts**: Inter + Rajdhani (Google Fonts)
- **Design**: Custom dark theme with glassmorphism, card-flip animations

---

## 📝 License

MIT — free to use, modify and distribute.

---

## 🤝 Contributing

Pull requests welcome! For major changes, open an issue first to discuss what you'd like to change.
