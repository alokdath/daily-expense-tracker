# Daily Expense Tracker

A lightweight personal expense tracker that runs locally in your browser. Built with plain HTML/CSS/JavaScript and a tiny Python standard-library server. It's installable as a PWA.

## Features
- Track expenses by category with custom colors
- Category types: expense, income, EMI and SIP
- Data saved locally to `data.json`, with no cloud or account needed
- Works offline (service worker + web app manifest)

## Run
```bash
cp data.sample.json data.json   # optional: start with sample data
python3 server.py               # then open http://localhost:8900
```

`data.json` holds your personal data and is git-ignored.
