const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const PORT = 3000;

// Database configuration
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'qwerty54321',
    database: 'todolist',
};

// Database functions
async function getItems() {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute('SELECT id, text FROM items');
    await connection.end();
    return rows;
}

async function addItem(text) {
    const connection = await mysql.createConnection(dbConfig);
    const [result] = await connection.execute(
        'INSERT INTO items (text) VALUES (?)',
        [text]
    );
    await connection.end();
    return result.insertId;
}

async function deleteItem(id) {
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute(
        'DELETE FROM items WHERE id = ?',
        [id]
    );
    await connection.end();
}

// HTML generation
async function generateHtmlRows() {
    const items = await getItems();
    return items.map(item => `
        <tr>
            <td>${item.id}</td>
            <td>${item.text}</td>
            <td>
                <button class="delete-btn" onclick="deleteItem(${item.id})">
                    Delete
                </button>
            </td>
        </tr>
    `).join('');
}

// Request handler
async function handleRequest(req, res) {
    // Serve HTML with items list
    if (req.url === '/' && req.method === 'GET') {
        try {
            let html = await fs.promises.readFile(
                path.join(__dirname, 'index.html'),
                'utf8'
            );
            html = html.replace('{{rows}}', await generateHtmlRows());
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error');
        }
    }
    // Add new item
    else if (req.url === '/items' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { text } = JSON.parse(body);
                await addItem(text);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error(error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        });
    }
    // Delete item
    else if (req.url.startsWith('/items/') && req.method === 'DELETE') {
        try {
            const id = req.url.split('/')[2];
            await deleteItem(id);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch (error) {
            console.error(error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: error.message }));
        }
    }
    // Not found
    else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
}

// Start server
const server = http.createServer(handleRequest);
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});