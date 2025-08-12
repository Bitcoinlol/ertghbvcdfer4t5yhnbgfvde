const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware setup
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

// In-memory data stores (replace with a database for production)
const scripts = {};
const keys = {}; // Stores user keys and their data
const plans = {
    '1-month': 30 * 24 * 60 * 60 * 1000
};

// Frontend routes to serve the HTML file
app.get('/', (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/panel", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get('/statues', (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/plans", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/about", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

// API to get a one-time free key
app.post("/api/free-key", (req, res) => {
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required.' });
    }

    // Check if the user already has a key (prevent multiple free keys)
    for (const key in keys) {
        if (keys[key].userId === userId) {
            return res.status(403).json({ error: 'You have already received a key.' });
        }
    }

    const newKey = uuidv4();
    const expiresAt = Date.now() + plans['1-month'];
    keys[newKey] = { userId, expiresAt, isPaid: false };
    console.log(`New FREE 1-month key generated for user ${userId}: ${newKey}`);
    res.json({ key: newKey, expiresAt, plan: '1-month' });
});

// API to check a key's validity
app.post('/api/check-key', (req, res) => {
    const { key } = req.body;
    const keyData = keys[key];

    if (!keyData || Date.now() > keyData.expiresAt) {
        delete keys[key];
        return res.status(401).json({ error: 'Invalid or expired key.' });
    }
    res.json({ status: 'valid', plan: keyData.isPaid ? 'Paid' : 'Free' });
});

// API to create a new script
app.post("/api/scripts", (req, res) => {
    const { code, isPaid, key } = req.body;

    // Check for required fields
    if (!code || !key) {
        return res.status(400).json({ error: 'Code and API key are required.' });
    }

    // Validate the API key
    const keyData = keys[key];
    if (!keyData || Date.now() > keyData.expiresAt) {
        return res.status(401).json({ error: 'Invalid or expired key.' });
    }

    const scriptId = uuidv4();
    scripts[scriptId] = {
        id: scriptId,
        key: key,
        userId: keyData.userId, // Associate the script with the user
        code,
        isPaid,
        whitelist: [],
        blacklist: [],
        executions: 0
    };
    console.log("Script created with ID: " + scriptId + " by user: " + keyData.userId);
    res.json({ id: scriptId, key });
});

// API to get all scripts
app.get("/api/scripts", (req, res) => {
    // In a real app, you would filter by user
    const allScripts = Object.values(scripts).map(script => ({
        id: script.id,
        isPaid: script.isPaid,
        executions: script.executions
    }));
    res.json(allScripts);
});

// API to delete a script
app.delete('/api/scripts/:id', (req, res) => {
    const { id } = req.params;
    if (scripts[id]) {
        delete scripts[id];
        console.log(`Script ${id} deleted.`);
        res.status(200).send("Script deleted");
    } else {
        res.status(404).send("Script not found");
    }
});

// API to get user lists (whitelist/blacklist)
app.get("/api/users/:id", (req, res) => {
    const { id } = req.params;
    const script = scripts[id];
    if (script) {
        res.json({ whitelist: script.whitelist, blacklist: script.blacklist });
    } else {
        res.status(404).send("Script not found.");
    }
});

// API to add user to a list
app.post('/api/users/:id/:listType', (req, res) => {
    const { id, listType } = req.params;
    const { userId } = req.body;
    const script = scripts[id];

    if (!script || (listType !== 'whitelist' && listType !== 'blacklist')) {
        return res.status(404).send("Invalid script or list type.");
    }

    if (!script[listType].includes(userId)) {
        script[listType].push(userId);
    }
    console.log(`User ${userId} added to ${listType} for script ${id}.`);
    res.status(200).send(`User added to ${listType}.`);
});

// API to remove user from a list
app.delete("/api/users/:id/:listType", (req, res) => {
    const { id, listType } = req.params;
    const { userId } = req.body;
    const script = scripts[id];

    if (!script || (listType !== 'whitelist' && listType !== 'blacklist')) {
        return res.status(404).send("Invalid script or list type.");
    }

    const index = script[listType].indexOf(userId);
    if (index > -1) {
        script[listType].splice(index, 1);
    }
    console.log(`User ${userId} removed from ${listType} for script ${id}.`);
    res.status(200).send(`User removed from ${listType}.`);
});

// Endpoint for Roblox execution
app.get("/raw/:id", (req, res) => {
    const { id } = req.params;
    const { key, userId } = req.query;
    const script = scripts[id];
    const keyData = keys[key];

    // Check for script existence and valid key/user combination
    if (!script || script.key !== key || !keyData || keyData.userId !== userId || Date.now() > keyData.expiresAt) {
        return res.status(403).send("Unauthorized");
    }

    // Handle blacklist/whitelist for paid scripts
    if (script.isPaid) {
        if (script.blacklist.includes(userId)) {
            return res.type('text/plain').send('game.Players.LocalPlayer:Kick("You are blacklisted from this script.")');
        }
        if (script.whitelist.length > 0 && !script.whitelist.includes(userId)) {
            return res.type('text/plain').send('game.Players.LocalPlayer:Kick("You are not whitelisted for this script.")');
        }
    }

    // Increment execution count and serve the script
    script.executions++;
    res.set("Content-Type", "text/plain");
    res.send(script.code);
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
